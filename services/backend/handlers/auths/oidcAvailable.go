package auths

import (
	"net/http"

	"justscan-backend/config"

	"github.com/gin-gonic/gin"
)

// OIDCAvailable returns login-method availability for the frontend.
// OIDC provider availability is determined by GET /api/v1/auth/oidc/providers.
func OIDCAvailable(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"oidc_enabled":       true,
		"local_auth_enabled": config.LocalAuthEnabled(),
		"sign_in_enabled":    config.SignInEnabled(),
		"sign_up_enabled":    config.SignUpEnabled(),
		"sso_only":           config.SSOOnly(),
	})
}
