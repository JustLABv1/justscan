package auths

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"justscan-backend/config"
	"justscan-backend/functions/auth"
	"justscan-backend/functions/httperror"
	"justscan-backend/pkg/models"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// OIDCCallbackMulti handles the OIDC callback for any named provider.
func OIDCCallbackMulti(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		providerName := c.Param("provider")

		// --- 1. Verify state ---
		stateParam := c.Query("state")
		stateCookie, err := c.Cookie("oidc_state")
		if err != nil || stateCookie == "" || stateCookie != stateParam {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid or missing state parameter"})
			return
		}
		c.SetSameSite(http.SameSiteLaxMode)
		c.SetCookie("oidc_state", "", -1, "/", "", false, true)
		c.SetCookie("oidc_provider", "", -1, "/", "", false, true)

		if errParam := c.Query("error"); errParam != "" {
			desc := c.Query("error_description")
			c.JSON(http.StatusUnauthorized, gin.H{"error": errParam, "error_description": desc})
			return
		}

		code := c.Query("code")
		if code == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing authorization code"})
			return
		}

		// --- 2. Load provider ---
		entry, err := auth.GetProviderEntry(c.Request.Context(), providerName)
		if err != nil {
			httperror.StatusNotFound(c, "OIDC provider not found", err)
			return
		}

		// --- 3. Exchange code for tokens ---
		oauth2Cfg := entry.GetOAuth2Config()
		token, err := oauth2Cfg.Exchange(c.Request.Context(), code)
		if err != nil {
			httperror.InternalServerError(c, "Failed to exchange authorization code", err)
			return
		}

		// --- 4. Verify ID token ---
		m := entry.GetModel()
		oidcVerifier := entry.GetProvider().Verifier(&gooidc.Config{ClientID: m.ClientID})
		rawIDToken, ok := token.Extra("id_token").(string)
		if !ok {
			httperror.InternalServerError(c, "ID token missing from provider response", errors.New("no id_token"))
			return
		}
		idToken, err := oidcVerifier.Verify(c.Request.Context(), rawIDToken)
		if err != nil {
			httperror.InternalServerError(c, "Failed to verify ID token", err)
			return
		}

		// --- 5. Extract claims ---
		claims, err := auth.ExtractOIDCClaimsForProvider(idToken, m)
		if err != nil {
			httperror.InternalServerError(c, "Failed to extract OIDC claims", err)
			return
		}
		if len(claims.Groups) == 0 && token.AccessToken != "" {
			userInfoGroups, userInfoErr := auth.FetchUserInfoGroups(c.Request.Context(), entry, token.AccessToken)
			if userInfoErr != nil {
				log.WithFields(log.Fields{"provider": providerName}).WithError(userInfoErr).Warn("oidc: failed to fetch groups from userinfo")
			} else if len(userInfoGroups) > 0 {
				claims.Groups = userInfoGroups
			}
		}

		if m.GroupsClaim != "" {
			log.WithFields(log.Fields{
				"provider":         providerName,
				"subject":          claims.Sub,
				"email":            claims.Email,
				"extracted_groups": claims.Groups,
			}).Debug("OIDC user details received")
		}

		// --- 6. Find or provision user ---
		user, err := findOrProvisionUserMulti(c.Request.Context(), db, providerName, claims)
		if err != nil {
			httperror.InternalServerError(c, "Failed to provision user account", err)
			return
		}

		if user.Disabled {
			c.JSON(http.StatusForbidden, gin.H{"error": "account is disabled: " + user.DisabledReason})
			return
		}

		// --- 7. Re-evaluate admin role ---
		newRole := "user"
		if auth.IsAdminForProvider(claims, m) || (providerName == "default" && auth.IsAdmin(claims)) {
			newRole = "admin"
		}
		if user.Role != newRole {
			user.Role = newRole
			if _, err := db.NewUpdate().Model(user).Column("role").Where("id = ?", user.ID).Exec(c.Request.Context()); err != nil {
				log.Warnf("oidc: failed to update user role: %v", err)
			}
		}

		// --- 8. Sync explicit OIDC claim mappings into org memberships ---
		syncOIDCClaimOrgs(c.Request.Context(), db, user.ID, providerName, claims.Groups, claims.Roles)

		if err := auth.RecordSuccessfulLogin(c.Request.Context(), db, user, "oidc"); err != nil {
			httperror.InternalServerError(c, "Failed to update login metadata", err)
			return
		}

		// --- 9. Issue JWT ---
		tokenString, expiresAt, err := auth.GenerateJWT(user.ID, false)
		if err != nil {
			httperror.InternalServerError(c, "Failed to generate session token", err)
			return
		}

		dbToken := models.Tokens{
			UserID:      user.ID.String(),
			Key:         tokenString,
			Description: fmt.Sprintf("OIDC login (%s)", providerName),
			Type:        "user",
			ExpiresAt:   time.Unix(expiresAt, 0),
			CreatedAt:   time.Now(),
		}
		if _, err := db.NewInsert().Model(&dbToken).Exec(c.Request.Context()); err != nil {
			httperror.InternalServerError(c, "Failed to store session token", err)
			return
		}

		frontendOrigin := deriveFrontendOrigin(config.Config)
		c.Redirect(http.StatusFound, frontendOrigin+"/auth/oidc/callback#token="+tokenString)
	}
}

// findOrProvisionUserMulti resolves a user via user_oidc_links (multi-provider),
// falls back to email merge, and JIT-creates if needed.
func findOrProvisionUserMulti(ctx context.Context, db *bun.DB, providerName string, claims *auth.OIDCClaims) (*models.Users, error) {
	// 1. Look up by (provider, subject) in user_oidc_links.
	var link models.UserOIDCLink
	err := db.NewSelect().Model(&link).
		Where("provider_name = ? AND oidc_subject = ?", providerName, claims.Sub).
		Scan(ctx)
	if err == nil {
		var user models.Users
		if err := db.NewSelect().Model(&user).Where("id = ?", link.UserID).Scan(ctx); err == nil {
			return &user, nil
		}
	}

	// 2. Legacy: look up by oidc_subject on users table (single-provider era).
	var legacyUser models.Users
	if err := db.NewSelect().Model(&legacyUser).Where("oidc_subject = ?", claims.Sub).Scan(ctx); err == nil {
		// Migrate to user_oidc_links.
		uuidID, _ := uuid.Parse(legacyUser.ID.String())
		linkNew := models.UserOIDCLink{
			UserID:       uuidID.String(),
			ProviderName: providerName,
			OIDCSubject:  claims.Sub,
			LinkedAt:     time.Now(),
		}
		db.NewInsert().Model(&linkNew).On("CONFLICT DO NOTHING").Exec(ctx) //nolint:errcheck
		return &legacyUser, nil
	}

	// 3. Look up by email (merge).
	if claims.Email != "" {
		var existing models.Users
		if err := db.NewSelect().Model(&existing).Where("email = ?", claims.Email).Scan(ctx); err == nil {
			uuidID, _ := uuid.Parse(existing.ID.String())
			link := models.UserOIDCLink{
				UserID:       uuidID.String(),
				ProviderName: providerName,
				OIDCSubject:  claims.Sub,
				LinkedAt:     time.Now(),
			}
			db.NewInsert().Model(&link).On("CONFLICT DO NOTHING").Exec(ctx) //nolint:errcheck
			return &existing, nil
		}
	}

	// 4. JIT-create.
	username := sanitiseUsername(claims.PreferredUsername)
	if username == "" {
		username = "oidc-user"
	}
	username, err = uniqueUsername(ctx, db, username)
	if err != nil {
		return nil, err
	}

	email := claims.Email
	if email == "" {
		email = claims.Sub + "@oidc.local"
	}

	count, err := db.NewSelect().Model((*models.Users)(nil)).Count(ctx)
	if err != nil {
		return nil, fmt.Errorf("oidc: failed to count users: %w", err)
	}
	role := "user"
	if count == 0 {
		role = "admin"
	}

	newUser := &models.Users{
		ID:       uuid.New(),
		Username: username,
		Email:    email,
		Password: "",
		Role:     role,
		AuthType: "oidc",
	}
	if _, err := db.NewInsert().Model(newUser).
		Column("id", "username", "email", "password", "role", "auth_type").
		Exec(ctx); err != nil {
		return nil, fmt.Errorf("oidc: failed to create user: %w", err)
	}

	link2 := models.UserOIDCLink{
		UserID:       newUser.ID.String(),
		ProviderName: providerName,
		OIDCSubject:  claims.Sub,
		LinkedAt:     time.Now(),
	}
	if _, err := db.NewInsert().Model(&link2).Exec(ctx); err != nil {
		log.Warnf("oidc: failed to create user_oidc_link: %v", err)
	}

	return newUser, nil
}
