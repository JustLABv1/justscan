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

		var scan models.Scan
		if err := db.NewSelect().Model(&scan).Where("id = ?", scanID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
			return
		}

		if scan.Status != models.ScanStatusPending && scan.Status != models.ScanStatusRunning {
			c.JSON(http.StatusBadRequest, gin.H{"error": "scan is not pending or running"})
			return
		}

		// Signal the worker to stop if it is currently running
		scanner.CancelScan(scanID)

		// Update the scan status to cancelled
		now := time.Now()
		scan.Status = models.ScanStatusCancelled
		scan.ErrorMessage = "Cancelled by user"
		scan.CompletedAt = &now
		db.NewUpdate().Model(&scan). //nolint:errcheck
						Column("status", "error_message", "completed_at").
						Where("id = ?", scanID).
						Exec(c.Request.Context())

		userID, _ := auth.GetUserIDFromToken(c.GetHeader("Authorization"))
		go audit.Write(context.Background(), db, userID.String(), "scan.cancel",
			fmt.Sprintf("Scan cancelled: %s:%s (id=%s)", scan.ImageName, scan.ImageTag, scanID))

		c.JSON(http.StatusOK, gin.H{"result": "scan cancelled"})
	}
}
