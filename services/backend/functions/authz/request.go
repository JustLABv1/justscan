package authz

import (
	"net/http"

	baseauth "justscan-backend/functions/auth"
	"justscan-backend/middlewares"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ResolveRequestUser(c *gin.Context, db *bun.DB) (uuid.UUID, bool, error) {
	userIDValue, hasUserID := c.Get(middlewares.AuthContextUserIDKey)
	isAdminValue, hasIsAdmin := c.Get(middlewares.AuthContextIsAdminKey)

	userID, userIDOK := userIDValue.(uuid.UUID)
	isAdmin, isAdminOK := isAdminValue.(bool)
	if hasUserID && hasIsAdmin && userIDOK && isAdminOK {
		return userID, isAdmin, nil
	}

	return baseauth.ResolveUserAccess(c.GetHeader("Authorization"), db)
}

func RequireRequestUser(c *gin.Context, db *bun.DB) (uuid.UUID, bool, bool) {
	userID, isAdmin, err := ResolveRequestUser(c, db)
	if err != nil {
		writeUserAccessError(c, err)
		return uuid.Nil, false, false
	}

	return userID, isAdmin, true
}

func RequireAdmin(c *gin.Context, db *bun.DB) (uuid.UUID, bool) {
	userID, isAdmin, ok := RequireRequestUser(c, db)
	if !ok {
		return uuid.Nil, false
	}
	if !isAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return uuid.Nil, false
	}

	return userID, true
}

func LoadAuthorizedOrg(c *gin.Context, db *bun.DB, orgID uuid.UUID) (*models.Org, uuid.UUID, bool, bool) {
	userID, isAdmin, ok := RequireRequestUser(c, db)
	if !ok {
		return nil, uuid.Nil, false, false
	}

	org := &models.Org{}
	if err := db.NewSelect().Model(org).Where("id = ?", orgID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "organization not found"})
		return nil, uuid.Nil, false, false
	}

	if !isAdmin && org.CreatedByID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "organization not found"})
		return nil, uuid.Nil, false, false
	}

	return org, userID, isAdmin, true
}

func LoadAuthorizedRegistry(c *gin.Context, db *bun.DB, registryID uuid.UUID) (*models.Registry, uuid.UUID, bool, bool) {
	userID, isAdmin, ok := RequireRequestUser(c, db)
	if !ok {
		return nil, uuid.Nil, false, false
	}

	registry := &models.Registry{}
	if err := db.NewSelect().Model(registry).Where("id = ?", registryID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "registry not found"})
		return nil, uuid.Nil, false, false
	}

	if !isAdmin && registry.CreatedByID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "registry not found"})
		return nil, uuid.Nil, false, false
	}

	return registry, userID, isAdmin, true
}

func writeUserAccessError(c *gin.Context, err error) {
	if err != nil && err.Error() == "user token required" {
		c.JSON(http.StatusForbidden, gin.H{"error": "user token required"})
		return
	}

	c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
}
