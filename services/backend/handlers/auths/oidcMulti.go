package auths

import (
	"net/http"

	"justscan-backend/functions/auth"
	"justscan-backend/functions/httperror"

	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2"
)

const oidcPKCEVerifierCookie = "oidc_pkce_verifier"

// OIDCProviders returns the list of enabled OIDC providers for the login page.
// This is a public endpoint — no authentication required.
func OIDCProviders(c *gin.Context) {
	providers, err := auth.ListEnabledProviders(c.Request.Context())
	if err != nil {
		httperror.InternalServerError(c, "Failed to list OIDC providers", err)
		return
	}

	result := make([]any, 0, len(providers))
	for _, p := range providers {
		result = append(result, map[string]any{
			"name":         p.Name,
			"display_name": p.DisplayName,
			"button_color": p.ButtonColor,
		})
	}
	c.JSON(http.StatusOK, result)
}

// OIDCLoginForProvider initiates the OIDC authorization code flow for the named provider.
func OIDCLoginForProvider(c *gin.Context) {
	providerName := c.Param("provider")
	// An abandoned diagnostic flow must not capture a later normal callback.
	clearOIDCDebugCookies(c)

	entry, err := auth.GetProviderEntry(c.Request.Context(), providerName)
	if err != nil {
		httperror.StatusNotFound(c, "OIDC provider not found", err)
		return
	}

	state, err := auth.GenerateStateToken()
	if err != nil {
		httperror.InternalServerError(c, "Failed to generate state token", err)
		return
	}
	verifier := oauth2.GenerateVerifier()

	// Keep the state and PKCE verifier in HTTP-only cookies for the callback.
	// The verifier never leaves the browser except in the server-to-server token
	// exchange, while the S256 challenge is sent to the identity provider.
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("oidc_state", state, 600, "/", "", false, true)
	c.SetCookie("oidc_provider", providerName, 600, "/", "", false, true)
	c.SetCookie(oidcPKCEVerifierCookie, verifier, 600, "/", "", false, true)

	cfg := entry.GetOAuth2Config()
	authURL := cfg.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier))
	c.Redirect(http.StatusFound, authURL)
}
