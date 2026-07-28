package scans

import (
	"context"
	"fmt"
	"net/http"

	"justscan-backend/functions/blockedpolicy"
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
		if err := blockedpolicy.AttachScanDetails(c.Request.Context(), db, scan); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load blocked policy details"})
			return
		}
		if err := attachPipelineInitiator(c.Request.Context(), db, scan); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan initiator"})
			return
		}

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

		if _, _, _, ok := LoadAuthorizedScanForWrite(c, db, scanID); !ok {
			return
		}

		if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			return deleteScanRecords(ctx, tx, []uuid.UUID{scanID})
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete scan"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}

func deleteScanRecords(ctx context.Context, db bun.IDB, scanIDs []uuid.UUID) error {
	if len(scanIDs) == 0 {
		return nil
	}

	for _, table := range []string{
		"comments",
		"vulnerabilities",
		"sbom_components",
		"sbom_documents",
		"scan_tags",
		"compliance_results",
		"compliance_history",
		"org_scans",
		"scan_manual_findings",
		"scan_step_logs",
		"xray_suppressions",
		"xray_request_logs",
		"pipeline_scan_requests",
	} {
		if _, err := db.NewDelete().TableExpr(table).Where("scan_id IN (?)", bun.In(scanIDs)).Exec(ctx); err != nil {
			return fmt.Errorf("delete %s: %w", table, err)
		}
	}

	_, err := db.NewDelete().Model((*models.Scan)(nil)).Where("id IN (?)", bun.In(scanIDs)).Exec(ctx)
	if err != nil {
		return fmt.Errorf("delete scans: %w", err)
	}
	return nil
}
