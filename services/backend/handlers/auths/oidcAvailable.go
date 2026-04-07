package auths

import (
	"net/http"

	"justscan-backend/config"

	"github.com/gin-gonic/gin"
)

// OIDCAvailable returns whether OIDC and local auth are enabled.
// This endpoint requires no authentication and is used by the frontend
// to decide which login options to display.
func OIDCAvailable(c *gin.Context) {
	cfg := config.Config
	c.JSON(http.StatusOK, gin.H{
		"oidc_enabled":       cfg.OIDC.Enabled,
		"local_auth_enabled": cfg.LocalAuth.Enabled,
	})
}
