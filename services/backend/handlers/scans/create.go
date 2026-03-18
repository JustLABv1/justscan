package scans

import (
	"net/http"
	"time"

	"justscan-backend/functions/auth"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

type CreateScanRequest struct {
	Image    string   `json:"image" binding:"required"`
	Tag      string   `json:"tag" binding:"required"`
	Platform string   `json:"platform"`
	TagIDs   []string `json:"tag_ids"`
}

func CreateScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateScanRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		userID, err := auth.GetUserIDFromToken(c.GetHeader("Authorization"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		scan := &models.Scan{
			ImageName: req.Image,
			ImageTag:  req.Tag,
			Platform:  req.Platform,
			Status:    models.ScanStatusPending,
			UserID:    &userID,
			CreatedAt: time.Now(),
		}
		if _, err := db.NewInsert().Model(scan).Exec(c.Request.Context()); err != nil {
			log.Errorf("CreateScan DB insert error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create scan"})
			return
		}

		// Attach tags if provided
		if len(req.TagIDs) > 0 {
			var scanTags []models.ScanTag
			for _, tagIDStr := range req.TagIDs {
				tagID, err := uuid.Parse(tagIDStr)
				if err != nil {
					continue
				}
				scanTags = append(scanTags, models.ScanTag{ScanID: scan.ID, TagID: tagID})
			}
			if len(scanTags) > 0 {
				db.NewInsert().Model(&scanTags).Exec(c.Request.Context()) //nolint:errcheck
			}
		}

		// Resolve registry credentials and enqueue scan
		envVars := resolveRegistryEnv(c.Request.Context(), db, req.Image)
		scanner.EnqueueScan(scan.ID, db, envVars, req.Platform)

		c.JSON(http.StatusCreated, scan)
	}
}

// resolveRegistryEnv returns env vars for registry auth. Implemented fully in Phase 10.
func resolveRegistryEnv(_ interface{ Done() <-chan struct{} }, _ *bun.DB, _ string) []string {
	return nil
}
