package auths

import (
	"net/http"

	"justscan-backend/functions/auth"
	"justscan-backend/functions/httperror"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

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
	dbValue, exists := c.Get("db")
	if exists {
		if db, ok := dbValue.(*bun.DB); ok {
			if !requireCompletedSetup(c, db) {
				return
			}
		}
	}

	providerName := c.Param("provider")

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

	// Store provider name in a cookie alongside the state so the callback knows
	// which provider to use.
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("oidc_state", state, 600, "/", "", false, true)
	c.SetCookie("oidc_provider", providerName, 600, "/", "", false, true)

	cfg := entry.GetOAuth2Config()
	authURL := cfg.AuthCodeURL(state)
	c.Redirect(http.StatusFound, authURL)
}
