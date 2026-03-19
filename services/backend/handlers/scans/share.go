package scans

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"

	"justscan-backend/functions/auth"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type createShareRequest struct {
	Visibility string `json:"visibility" binding:"required"` // "public" or "authenticated"
}

// CreateShare generates a share token for a scan owned by the requesting user.
func CreateShare(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		userID, err := auth.GetUserIDFromToken(c.GetHeader("Authorization"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		var req createShareRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}
		if req.Visibility != "public" && req.Visibility != "authenticated" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "visibility must be 'public' or 'authenticated'"})
			return
		}

		// Verify scan ownership (admin can share any scan)
		tokenType, _ := auth.GetTypeFromToken(c.GetHeader("Authorization"))
		var scan models.Scan
		q := db.NewSelect().Model(&scan).Where("id = ?", scanID)
		if tokenType != "admin" {
			q = q.Where("user_id = ?", userID)
		}
		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
			return
		}

		// Generate 32-byte crypto-random token (64 hex chars)
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
			return
		}
		token := hex.EncodeToString(raw)

		if _, err := db.NewUpdate().Model((*models.Scan)(nil)).
			Set("share_token = ?", token).
			Set("share_visibility = ?", req.Visibility).
			Where("id = ?", scanID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update scan"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"share_token":      token,
			"share_visibility": req.Visibility,
		})
	}
}

// DeleteShare removes the share token from a scan, disabling further access.
func DeleteShare(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		userID, err := auth.GetUserIDFromToken(c.GetHeader("Authorization"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		tokenType, _ := auth.GetTypeFromToken(c.GetHeader("Authorization"))
		var scan models.Scan
		q := db.NewSelect().Model(&scan).Where("id = ?", scanID)
		if tokenType != "admin" {
			q = q.Where("user_id = ?", userID)
		}
		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
			return
		}

		if _, err := db.NewUpdate().Model((*models.Scan)(nil)).
			Set("share_token = NULL").
			Set("share_visibility = NULL").
			Where("id = ?", scanID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update scan"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "success"})
	}
}
