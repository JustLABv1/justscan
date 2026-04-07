package scans

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"

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

		var req createShareRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}
		if req.Visibility != "public" && req.Visibility != "authenticated" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "visibility must be 'public' or 'authenticated'"})
			return
		}

		if _, _, _, ok := LoadAuthorizedScan(c, db, scanID); !ok {
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

		if _, _, _, ok := LoadAuthorizedScan(c, db, scanID); !ok {
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
