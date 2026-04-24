package scans

import (
	"net/http"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func UpdateScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		var body struct {
			ImageLocation string `json:"image_location"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}

		if _, _, _, ok := LoadAuthorizedScanForWrite(c, db, scanID); !ok {
			return
		}

		if _, err := db.NewUpdate().
			Model((*models.Scan)(nil)).
			Set("image_location = ?", body.ImageLocation).
			Where("id = ?", scanID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update scan"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}
