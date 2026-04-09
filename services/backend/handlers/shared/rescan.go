package shared

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"justscan-backend/functions/audit"
	"justscan-backend/functions/auth"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// RescanShared creates a new scan from a shared link.
// Authenticated callers get a user-owned scan; anonymous callers get a public scan.
func RescanShared(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orig := getScanByShareToken(c, db)
		if orig == nil {
			return
		}

		newScan := &models.Scan{
			ImageName:        orig.ImageName,
			ImageTag:         orig.ImageTag,
			Platform:         orig.Platform,
			RegistryID:       orig.RegistryID,
			ScanProvider:     orig.ScanProvider,
			CurrentStep:      models.ScanStepQueued,
			HelmScanRunID:    orig.HelmScanRunID,
			HelmChart:        orig.HelmChart,
			HelmChartName:    orig.HelmChartName,
			HelmChartVersion: orig.HelmChartVersion,
			HelmSourcePath:   orig.HelmSourcePath,
			Status:           models.ScanStatusPending,
			CreatedAt:        time.Now(),
		}

		// Determine caller authentication status
		raw := c.GetHeader("Authorization")
		tokenString := strings.TrimPrefix(raw, "Bearer ")
		isAuthenticated := tokenString != "" && auth.ValidateToken(tokenString) == nil

		scanType := "public"
		if isAuthenticated {
			userID, err := auth.GetUserIDFromToken(raw)
			if err == nil {
				newScan.UserID = &userID
				scanType = "authenticated"
			}
		} else {
			// Public rescans respect the public scan enabled flag
			if !isPublicScanEnabled(c.Request.Context(), db) {
				c.JSON(http.StatusForbidden, gin.H{"error": "public scanning is currently disabled"})
				return
			}
		}

		if _, err := db.NewInsert().Model(newScan).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create scan"})
			return
		}

		if err := scanner.DispatchScan(c.Request.Context(), db, newScan, nil, orig.Platform); err != nil {
			log.Warnf("RescanShared dispatch failed for %s: %v", newScan.ID, err)
			if markErr := scanner.MarkScanFailed(c.Request.Context(), db, newScan.ID, err.Error()); markErr != nil {
				log.Errorf("RescanShared failed to persist dispatch error for %s: %v", newScan.ID, markErr)
			} else {
				completedAt := time.Now()
				newScan.Status = models.ScanStatusFailed
				newScan.CurrentStep = models.ScanStepFailed
				newScan.ErrorMessage = err.Error()
				newScan.CompletedAt = &completedAt
			}
		}

		actorID := "public"
		if newScan.UserID != nil {
			actorID = newScan.UserID.String()
		}
		go audit.Write(context.Background(), db, actorID, "scan.shared.rescan",
			fmt.Sprintf("Rescan via shared link for %s:%s (new=%s)", orig.ImageName, orig.ImageTag, newScan.ID))

		c.JSON(http.StatusCreated, gin.H{
			"scan_id": newScan.ID,
			"type":    scanType,
		})
	}
}

func isPublicScanEnabled(ctx context.Context, db *bun.DB) bool {
	var setting models.SystemSetting
	if err := db.NewSelect().Model(&setting).Where("key = ?", "public_scan_enabled").Scan(ctx); err != nil {
		return false
	}
	return setting.Value == "true"
}
