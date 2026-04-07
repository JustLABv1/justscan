package scans

import (
	"net/http"

	"justscan-backend/functions/auth"
	"justscan-backend/functions/gatekeeper"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// LoadAuthorizedScan ensures the caller is a user and can access the scan
// either by ownership or admin role.
func LoadAuthorizedScan(c *gin.Context, db *bun.DB, scanID uuid.UUID) (*models.Scan, uuid.UUID, bool, bool) {
	tokenType, err := auth.GetTypeFromToken(c.GetHeader("Authorization"))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return nil, uuid.Nil, false, false
	}
	if tokenType != "user" {
		c.JSON(http.StatusForbidden, gin.H{"error": "scan access requires a user token"})
		return nil, uuid.Nil, false, false
	}

	userID, err := auth.GetUserIDFromToken(c.GetHeader("Authorization"))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return nil, uuid.Nil, false, false
	}

	isAdmin, err := gatekeeper.CheckAdmin(userID, db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to verify access"})
		return nil, uuid.Nil, false, false
	}

	scan := &models.Scan{}
	if err := db.NewSelect().Model(scan).Where("id = ?", scanID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
		return nil, uuid.Nil, false, false
	}

	if !isAdmin {
		if scan.UserID == nil || *scan.UserID != userID {
			c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
			return nil, uuid.Nil, false, false
		}
	}

	return scan, userID, isAdmin, true
}
