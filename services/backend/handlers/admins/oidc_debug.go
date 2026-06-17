package admins

import (
	"fmt"
	"net/http"
	"net/url"

	"justscan-backend/functions/auth"
	"justscan-backend/functions/httperror"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func CreateOIDCDebugSession(c *gin.Context) {
	providerName := c.Param("name")
	if _, err := auth.GetProviderEntry(c.Request.Context(), providerName); err != nil {
		httperror.StatusNotFound(c, "OIDC provider not found or disabled", err)
		return
	}

	ownerID, err := oidcDebugOwnerID(c)
	if err != nil {
		httperror.Unauthorized(c, "OIDC diagnostics require an administrator user session", err)
		return
	}
	session, err := auth.CreateOIDCDebugSession(providerName, ownerID.String())
	if err != nil {
		httperror.InternalServerError(c, "Failed to create OIDC debug session", err)
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"session_id": session.ID,
		"expires_at": session.ExpiresAt,
		"login_url":  fmt.Sprintf("/api/v1/auth/oidc/%s/debug/%s/login", url.PathEscape(providerName), session.ID),
	})
}

func GetOIDCDebugSession(c *gin.Context) {
	ownerID, err := oidcDebugOwnerID(c)
	if err != nil {
		httperror.Unauthorized(c, "OIDC diagnostics require an administrator user session", err)
		return
	}
	session, err := auth.GetOIDCDebugSessionForAdmin(c.Param("sessionID"), ownerID.String())
	if err != nil {
		httperror.StatusNotFound(c, "OIDC debug session not found or expired", err)
		return
	}
	status := "pending"
	if session.Report != nil {
		status = "complete"
	}
	c.JSON(http.StatusOK, gin.H{
		"session_id":    session.ID,
		"provider_name": session.ProviderName,
		"expires_at":    session.ExpiresAt,
		"status":        status,
		"report":        session.Report,
	})
}

func oidcDebugOwnerID(c *gin.Context) (uuid.UUID, error) {
	raw, exists := c.Get(middlewares.AuthContextUserIDKey)
	if !exists {
		return uuid.Nil, fmt.Errorf("authenticated user ID is unavailable")
	}
	switch value := raw.(type) {
	case uuid.UUID:
		return value, nil
	case string:
		return uuid.Parse(value)
	default:
		return uuid.Nil, fmt.Errorf("authenticated user ID has unexpected type")
	}
}
