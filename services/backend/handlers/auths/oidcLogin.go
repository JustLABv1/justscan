package auths

import (
	"errors"
	"net/http"

	"justscan-backend/config"
	"justscan-backend/functions/auth"
	"justscan-backend/functions/httperror"

	"github.com/gin-gonic/gin"
)

// OIDCLogin initiates the OIDC authorization code flow.
func OIDCLogin(c *gin.Context) {
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

	oauth2Cfg := auth.GetOIDCOAuth2Config()
	authURL := oauth2Cfg.AuthCodeURL(state)
	c.Redirect(http.StatusFound, authURL)
}
