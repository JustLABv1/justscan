package auths

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"justscan-backend/config"
	"justscan-backend/functions/auth"
	"justscan-backend/functions/httperror"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func resolveLegacyOIDCProviderName(ctx context.Context, hintedProvider string) string {
	hintedProvider = strings.TrimSpace(hintedProvider)
	if hintedProvider != "" {
		if _, err := auth.GetProviderEntry(ctx, hintedProvider); err == nil {
			return hintedProvider
		}
	}

	providers, err := auth.ListEnabledProviders(ctx)
	if err == nil {
		if len(providers) == 1 {
			return providers[0].Name
		}
		for _, provider := range providers {
			if provider.Name == "default" {
				return provider.Name
			}
		}
	}

	return "default"
}

// OIDCLogin initiates the OIDC authorization code flow.
func OIDCLogin(c *gin.Context) {
	dbValue, exists := c.Get("db")
	if exists {
		if db, ok := dbValue.(*bun.DB); ok {
			if !requireCompletedSetup(c, db) {
				return
			}
		}
	}

	if !config.Config.OIDC.Enabled {
		httperror.StatusNotFound(c, "OIDC is not enabled", errors.New("oidc not enabled"))
		return
	}

	state, err := auth.GenerateStateToken()
	if err != nil {
		httperror.InternalServerError(c, "Failed to generate state token", err)
		return
	}

	// Store state in a short-lived (10 min), httponly, SameSite=Lax cookie.
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("oidc_state", state, 600, "/", "", false, true)

	providerName := resolveLegacyOIDCProviderName(c.Request.Context(), "")
	if providerName != "" {
		c.SetCookie("oidc_provider", providerName, 600, "/", "", false, true)
		if entry, err := auth.GetProviderEntry(c.Request.Context(), providerName); err == nil && entry != nil {
			providerOAuth2Cfg := entry.GetOAuth2Config()
			authURL := providerOAuth2Cfg.AuthCodeURL(state)
			c.Redirect(http.StatusFound, authURL)
			return
		}
	}

	oauth2Cfg := auth.GetOIDCOAuth2Config()
	authURL := oauth2Cfg.AuthCodeURL(state)
	c.Redirect(http.StatusFound, authURL)
}
