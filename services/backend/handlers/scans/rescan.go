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

// ReScan creates a new scan with the same image/tag/platform as an existing scan.
func ReScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		var orig models.Scan
		if err := db.NewSelect().Model(&orig).Where("id = ?", scanID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
			return
		}

		userID, err := auth.GetUserIDFromToken(c.GetHeader("Authorization"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		newScan := &models.Scan{
			ImageName:        orig.ImageName,
			ImageTag:         orig.ImageTag,
			Platform:         orig.Platform,
			RegistryID:       orig.RegistryID,
			ScanProvider:     orig.ScanProvider,
			HelmScanRunID:    orig.HelmScanRunID,
			HelmChart:        orig.HelmChart,
			HelmChartName:    orig.HelmChartName,
			HelmChartVersion: orig.HelmChartVersion,
			HelmSourcePath:   orig.HelmSourcePath,
			Status:           models.ScanStatusPending,
			UserID:           &userID,
			CreatedAt:        time.Now(),
		}
		if _, err := db.NewInsert().Model(newScan).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create rescan"})
			return
		}

		registry, envVars, err := scanner.ResolveRegistryForScan(c.Request.Context(), db, orig.ImageName, orig.RegistryID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		normalizedImageName, normalizedImageTag := scanner.NormalizeScanTarget(orig.ImageName, orig.ImageTag, registry)
		newScan.ImageName = normalizedImageName
		newScan.ImageTag = normalizedImageTag
		if registry != nil {
			newScan.RegistryID = &registry.ID
			newScan.ScanProvider = scanner.ProviderForRegistry(registry)
		}
		if err := scanner.DispatchScan(c.Request.Context(), db, newScan, envVars, orig.Platform); err != nil {
			log.Warnf("ReScan dispatch failed for %s: %v", newScan.ID, err)
			if markErr := scanner.MarkScanFailed(c.Request.Context(), db, newScan.ID, err.Error()); markErr != nil {
				log.Errorf("ReScan failed to persist dispatch error for %s: %v", newScan.ID, markErr)
			} else {
				completedAt := time.Now()
				newScan.Status = models.ScanStatusFailed
				newScan.ErrorMessage = err.Error()
				newScan.CompletedAt = &completedAt
			}
		}

		go audit.Write(context.Background(), db, userID.String(), "scan.rescan",
			fmt.Sprintf("Rescan of %s:%s (original=%s, new=%s)", orig.ImageName, orig.ImageTag, orig.ID, newScan.ID))

		c.JSON(http.StatusCreated, newScan)
	}
}
