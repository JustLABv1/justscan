package scans

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"justscan-backend/functions/audit"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// CancelScan stops a pending or running scan.
func CancelScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		scan, userID, _, ok := LoadAuthorizedScan(c, db, scanID)
		if !ok {
			return
		}

		if scan.Status != models.ScanStatusPending && scan.Status != models.ScanStatusRunning {
			c.JSON(http.StatusBadRequest, gin.H{"error": "scan is not pending or running"})
			return
		}

		// Signal the worker to stop if it is currently running
		scanner.CancelScan(scanID)

		// Update the scan status to cancelled
		ctx := context.Background()
		now := time.Now()
		scan.Status = models.ScanStatusCancelled
		scan.ErrorMessage = "Cancelled by user"
		scan.CompletedAt = &now
		columns := []string{"status", "error_message", "completed_at"}
		if scan.ScanProvider == models.ScanProviderArtifactoryXray {
			scan.ExternalStatus = models.ScanStatusCancelled
			columns = append(columns, "external_status")
		}
		if _, err := db.NewUpdate().Model(scan).
			Column(columns...).
			Where("id = ?", scanID).
			Exec(ctx); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to cancel scan"})
			return
		}

		go audit.Write(ctx, db, userID.String(), "scan.cancel",
			fmt.Sprintf("Scan cancelled: %s:%s (id=%s)", scan.ImageName, scan.ImageTag, scanID))

		c.JSON(http.StatusOK, gin.H{
			"result":          "scan cancelled",
			"status":          scan.Status,
			"external_status": scan.ExternalStatus,
			"completed_at":    scan.CompletedAt,
			"error_message":   scan.ErrorMessage,
		})
	}
}
