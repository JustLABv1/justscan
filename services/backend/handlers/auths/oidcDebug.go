package auths

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"

	"justscan-backend/config"
	"justscan-backend/functions/auth"
	"justscan-backend/functions/httperror"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2"
)

const (
	oidcDebugStateCookie    = "oidc_debug_state"
	oidcDebugPKCECookie     = "oidc_debug_pkce"
	oidcDebugSessionCookie  = "oidc_debug_session"
	oidcDebugCookieLifetime = 600
)

// OIDCDebugLogin starts a diagnostic authorization flow created by an admin.
// The configured callback URI is reused, so providers need no extra redirect URI.
func OIDCDebugLogin(c *gin.Context) {
	providerName := c.Param("provider")
	sessionID := c.Param("session")
	if _, err := auth.GetOIDCDebugSessionForFlow(sessionID, providerName); err != nil {
		httperror.StatusNotFound(c, "OIDC debug session not found or expired", err)
		return
	}
	entry, err := auth.GetProviderEntry(c.Request.Context(), providerName)
	if err != nil {
		httperror.StatusNotFound(c, "OIDC provider not found", err)
		return
	}
	state, err := auth.GenerateStateToken()
	if err != nil {
		httperror.InternalServerError(c, "Failed to generate OIDC debug state", err)
		return
	}
	verifier := oauth2.GenerateVerifier()
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(oidcDebugStateCookie, state, oidcDebugCookieLifetime, "/", "", false, true)
	c.SetCookie(oidcDebugPKCECookie, verifier, oidcDebugCookieLifetime, "/", "", false, true)
	c.SetCookie(oidcDebugSessionCookie, sessionID, oidcDebugCookieLifetime, "/", "", false, true)
	oauth2Config := entry.GetOAuth2Config()
	c.Redirect(http.StatusFound, oauth2Config.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier)))
}

func hasOIDCDebugSession(c *gin.Context) bool {
	value, err := c.Cookie(oidcDebugSessionCookie)
	return err == nil && value != ""
}

func handleOIDCDebugCallback(c *gin.Context, providerName string) {
	sessionID, sessionErr := c.Cookie(oidcDebugSessionCookie)
	stateCookie, stateErr := c.Cookie(oidcDebugStateCookie)
	pkceVerifier, pkceErr := c.Cookie(oidcDebugPKCECookie)
	clearOIDCDebugCookies(c)
	if sessionErr != nil || stateErr != nil || pkceErr != nil || sessionID == "" ||
		stateCookie == "" || stateCookie != c.Query("state") || pkceVerifier == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid or expired OIDC debug session"})
		return
	}
	if _, err := auth.GetOIDCDebugSessionForFlow(sessionID, providerName); err != nil {
		httperror.StatusNotFound(c, "OIDC debug session not found or expired", err)
		return
	}
	if providerError := c.Query("error"); providerError != "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":             providerError,
			"error_description": c.Query("error_description"),
		})
		return
	}
	code := c.Query("code")
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing authorization code"})
		return
	}

	entry, err := auth.GetProviderEntry(c.Request.Context(), providerName)
	if err != nil {
		httperror.StatusNotFound(c, "OIDC provider not found", err)
		return
	}
	oauth2Config := entry.GetOAuth2Config()
	token, err := oauth2Config.Exchange(c.Request.Context(), code, oauth2.VerifierOption(pkceVerifier))
	if err != nil {
		httperror.InternalServerError(c, "Failed to exchange OIDC debug authorization code", err)
		return
	}
	model := entry.GetModel()
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		httperror.InternalServerError(c, "ID token missing from provider response", errors.New("no id_token"))
		return
	}
	idToken, err := entry.GetProvider().Verifier(&gooidc.Config{ClientID: model.ClientID}).Verify(c.Request.Context(), rawIDToken)
	if err != nil {
		httperror.InternalServerError(c, "Failed to verify OIDC debug ID token", err)
		return
	}
	claims, err := auth.ExtractOIDCClaimsForProvider(idToken, model)
	if err != nil {
		httperror.InternalServerError(c, "Failed to extract OIDC debug claims", err)
		return
	}

	groupsPath := model.GroupsClaim
	if groupsPath == "" {
		groupsPath = "groups"
	}
	rolesPath := model.RolesClaim
	if rolesPath == "" {
		rolesPath = "roles"
	}
	clientRolesPath := fmt.Sprintf("resource_access.%s.roles", model.ClientID)
	report := &auth.OIDCDebugReport{
		ProviderName:    providerName,
		IDTokenClaims:   claims.RawClaims,
		GroupsClaimPath: groupsPath,
		RolesClaimPath:  rolesPath,
		ResolvedGroups:  claims.Groups,
		ResolvedRoles:   claims.Roles,
		RealmRoles:      auth.ExtractStringSliceForDebug(claims.RawClaims, "realm_access.roles"),
		ClientRoles:     auth.ExtractStringSliceForDebug(claims.RawClaims, clientRolesPath),
		ClientRolesPath: clientRolesPath,
		WouldBeAdmin:    auth.IsAdminForProvider(claims, model),
	}
	if token.AccessToken != "" {
		userInfoClaims, userInfoErr := auth.FetchUserInfoClaims(c.Request.Context(), entry, token.AccessToken)
		if userInfoErr != nil {
			report.UserInfoError = userInfoErr.Error()
		} else {
			report.UserInfoClaims = userInfoClaims
			if len(report.ResolvedGroups) == 0 {
				report.ResolvedGroups = auth.ExtractStringSliceForDebug(userInfoClaims, groupsPath)
			}
		}
	}
	if err := auth.CompleteOIDCDebugSession(sessionID, providerName, report); err != nil {
		httperror.StatusNotFound(c, "OIDC debug session not found or expired", err)
		return
	}

	frontendOrigin := deriveFrontendOrigin(config.Config, c.Request)
	c.Redirect(http.StatusFound, frontendOrigin+"/admin/identity?oidc_debug="+url.QueryEscape(sessionID))
}

func clearOIDCDebugCookies(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(oidcDebugStateCookie, "", -1, "/", "", false, true)
	c.SetCookie(oidcDebugPKCECookie, "", -1, "/", "", false, true)
	c.SetCookie(oidcDebugSessionCookie, "", -1, "/", "", false, true)
}
