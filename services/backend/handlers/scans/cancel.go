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
	log "github.com/sirupsen/logrus"
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

		scan, userID, _, ok := LoadAuthorizedScanForWrite(c, db, scanID)
		if !ok {
			return
		}

		if scan.Status != models.ScanStatusPending && scan.Status != models.ScanStatusRunning {
			c.JSON(http.StatusBadRequest, gin.H{"error": "scan is not pending or running"})
			return
		}
		wasPending := scan.Status == models.ScanStatusPending
		queuedScan := *scan
		var archiveSessions []models.ArchiveUploadSession
		if scan.ScanSource == models.ScanSourceUploadedArchive {
			archiveSessions, err = loadArchiveUploadSessionsForScans(c.Request.Context(), db, []uuid.UUID{scanID})
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve uploaded archive cleanup"})
				return
			}
		}

		// Signal the worker to stop if it is currently running
		scanner.CancelScan(scanID)

		// Update the scan status to cancelled
		ctx := context.Background()
		now := time.Now()
		scan.Status = models.ScanStatusCancelled
		scan.CurrentStep = models.ScanStepCancelled
		scan.ErrorMessage = "Cancelled by user"
		scan.CompletedAt = &now
		scan.LastProgressAt = &now
		columns := []string{"status", "current_step", "error_message", "completed_at", "last_progress_at"}
		if scan.ScanProvider == models.ScanProviderArtifactoryXray {
			scan.ExternalStatus = models.ScanStatusCancelled
			columns = append(columns, "external_status")
		}
		result, err := db.NewUpdate().Model(scan).
			Column(columns...).
			Where("id = ? AND status IN (?)", scanID, bun.In([]string{models.ScanStatusPending, models.ScanStatusRunning})).
			Exec(ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to cancel scan"})
			return
		}
		rows, rowsErr := result.RowsAffected()
		if rowsErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to cancel scan"})
			return
		}
		if rows == 0 {
			c.JSON(http.StatusConflict, gin.H{"error": "scan reached a terminal state before cancellation"})
			return
		}
		if wasPending && len(archiveSessions) > 0 {
			if err := deleteArchiveUploadSessionsForScans(ctx, db, []uuid.UUID{scanID}); err != nil {
				log.WithError(err).Warnf("failed to remove archive upload session for cancelled scan %s", scanID)
			}
		}
		// A pending scan has no worker that can perform archive cleanup. A
		// running scan is allowed to finish its worker defer after cancellation.
		// Keep the original queued state for the one-shot cleanup guard because
		// the in-memory scan has now transitioned to cancelled.
		if wasPending {
			_ = cleanupArchiveUploadSessions(archiveSessions)
			_ = cleanupQueuedUploadedArchiveScan(&queuedScan)
		}
		if err := scanner.MarkScanCancelled(ctx, db, scanID, scan.ErrorMessage); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record cancelled scan step"})
			return
		}
		go audit.Write(ctx, db, userID.String(), "scan.cancel",
			fmt.Sprintf("Scan cancelled: %s:%s (id=%s)", scan.ImageName, scan.ImageTag, scanID))

		c.JSON(http.StatusOK, gin.H{
			"result":          "scan cancelled",
			"status":          scan.Status,
			"current_step":    scan.CurrentStep,
			"external_status": scan.ExternalStatus,
			"completed_at":    scan.CompletedAt,
			"error_message":   scan.ErrorMessage,
		})
	}
}
