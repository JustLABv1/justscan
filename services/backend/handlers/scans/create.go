package scans

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"justscan-backend/functions/audit"
	"justscan-backend/functions/auth"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

type CreateScanRequest struct {
	Image      string   `json:"image" binding:"required"`
	Tag        string   `json:"tag" binding:"required"`
	Platform   string   `json:"platform"`
	RegistryID string   `json:"registry_id"`
	TagIDs     []string `json:"tag_ids"`
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

		var requestedRegistryID *uuid.UUID
		if req.RegistryID != "" {
			parsedRegistryID, err := uuid.Parse(req.RegistryID)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry_id"})
				return
			}
			requestedRegistryID = &parsedRegistryID
		}

		registry, envVars, err := scanner.ResolveRegistryForScan(c.Request.Context(), db, req.Image, requestedRegistryID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		normalizedImageName, normalizedImageTag := scanner.NormalizeScanTarget(req.Image, req.Tag, registry)

		scan := &models.Scan{
			ImageName:    normalizedImageName,
			ImageTag:     normalizedImageTag,
			Platform:     req.Platform,
			RegistryID:   requestedRegistryID,
			ScanProvider: scanner.ProviderForRegistry(registry),
			Status:       models.ScanStatusPending,
			UserID:       &userID,
			CreatedAt:    time.Now(),
		}
		if registry != nil {
			scan.RegistryID = &registry.ID
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

		if err := scanner.DispatchScan(c.Request.Context(), db, scan, envVars, req.Platform); err != nil {
			log.Warnf("CreateScan dispatch failed for %s: %v", scan.ID, err)
			if markErr := scanner.MarkScanFailed(c.Request.Context(), db, scan.ID, err.Error()); markErr != nil {
				log.Errorf("CreateScan failed to persist dispatch error for %s: %v", scan.ID, markErr)
			} else {
				completedAt := time.Now()
				scan.Status = models.ScanStatusFailed
				scan.ErrorMessage = err.Error()
				scan.CompletedAt = &completedAt
			}
		}

		go audit.Write(context.Background(), db, userID.String(), "scan.create",
			fmt.Sprintf("Scan created for %s:%s (id=%s)", scan.ImageName, scan.ImageTag, scan.ID))

		c.JSON(http.StatusCreated, scan)
	}
}
