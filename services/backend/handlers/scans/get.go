package scans

import (
	"net/http"

	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func GetScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var stepOutputCount int

		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		scan, _, _, ok := LoadAuthorizedScan(c, db, scanID)
		if !ok {
			return
		}

		if scan.Status == models.ScanStatusCompleted {
			if _, err := scanner.EnsureScanImageDigest(c.Request.Context(), db, scan); err != nil {
				// Older Xray scans may need a best-effort digest backfill so suppression keys work.
			}
		}

		// Load tags
		var tags []models.Tag
		db.NewSelect().
			TableExpr("tags AS t").
			ColumnExpr("t.*").
			Join("JOIN scan_tags st ON st.tag_id = t.id").
			Where("st.scan_id = ?", scanID).
			Scan(c.Request.Context(), &tags) //nolint:errcheck
		scan.Tags = tags

		var stepLogs []models.ScanStepLog
		stepLogsQuery := db.NewSelect().
			Model(&stepLogs).
			Where("scan_id = ?", scanID).
			OrderExpr("position ASC")
		if scan.Status == models.ScanStatusPending || scan.Status == models.ScanStatusRunning {
			stepLogsQuery = db.NewSelect().
				Model(&stepLogs).
				Column("id", "scan_id", "step", "position", "started_at", "completed_at").
				ColumnExpr("CASE WHEN jsonb_typeof(output) = 'array' AND jsonb_array_length(output) > 0 THEN jsonb_build_array(output -> (jsonb_array_length(output) - 1)) ELSE '[]'::jsonb END AS output").
				ColumnExpr("CASE WHEN jsonb_typeof(output) = 'array' THEN jsonb_array_length(output) ELSE 0 END AS output_count").
				Where("scan_id = ?", scanID).
				OrderExpr("position ASC")
		}
		stepLogsQuery.Scan(c.Request.Context()) //nolint:errcheck
		for _, stepLog := range stepLogs {
			stepOutputCount += stepLog.OutputCount
			if stepLog.OutputCount == 0 {
				stepOutputCount += len(stepLog.Output)
			}
		}
		scan.StepLogs = stepLogs

		c.JSON(http.StatusOK, scan)
	}
}

func DeleteScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		if _, _, _, ok := LoadAuthorizedScan(c, db, scanID); !ok {
			return
		}

		ctx := c.Request.Context()

		// Cascade delete related data
		db.NewDelete().TableExpr("comments").Where("scan_id = ?", scanID).Exec(ctx)        //nolint:errcheck
		db.NewDelete().TableExpr("vulnerabilities").Where("scan_id = ?", scanID).Exec(ctx) //nolint:errcheck
		db.NewDelete().TableExpr("sbom_components").Where("scan_id = ?", scanID).Exec(ctx) //nolint:errcheck
		db.NewDelete().TableExpr("scan_tags").Where("scan_id = ?", scanID).Exec(ctx)       //nolint:errcheck

		if _, err := db.NewDelete().Model((*models.Scan)(nil)).Where("id = ?", scanID).Exec(ctx); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete scan"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}
