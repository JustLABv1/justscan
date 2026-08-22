package scans

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"justscan-backend/compliance"
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
		if scan.IntelligenceVersions, err = scanner.LoadScanIntelligenceVersions(c.Request.Context(), db, scanID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan intelligence versions"})
			return
		}
		intelligenceSummaries, summaryErr := compliance.LoadIntelligenceSummaries(c.Request.Context(), db, []uuid.UUID{scanID})
		if summaryErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan intelligence summary"})
			return
		}
		scan.IntelligenceSummary = intelligenceSummaries[scanID]

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

		scan, _, _, ok := LoadAuthorizedScanForWrite(c, db, scanID)
		if !ok {
			return
		}
		archiveSessions, err := loadArchiveUploadSessionsForScans(c.Request.Context(), db, []uuid.UUID{scanID})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve uploaded archive cleanup"})
			return
		}

		if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			return deleteScanRecords(ctx, tx, []uuid.UUID{scanID})
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete scan"})
			return
		}
		_ = cleanupArchiveUploadSessions(archiveSessions)
		_ = cleanupQueuedUploadedArchiveScan(scan)

		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}

// cleanupQueuedUploadedArchiveScan only removes the private directory created
// for this scan. In particular, it never trusts an arbitrary image_location
// value from the database or request body as a path to delete.
func cleanupQueuedUploadedArchiveScan(scan *models.Scan) error {
	if scan == nil || scan.ScanSource != models.ScanSourceUploadedArchive {
		return nil
	}
	if scan.Status != models.ScanStatusPending || scan.CurrentStep != models.ScanStepQueued {
		return nil
	}
	if !isControlledUploadedArchivePath(scan.ImageLocation) {
		return nil
	}
	root := filepath.Join(os.TempDir(), "justscan", "uploads")
	relative, err := filepath.Rel(root, filepath.Clean(scan.ImageLocation))
	if err != nil {
		return nil
	}
	parts := strings.Split(relative, string(filepath.Separator))
	if len(parts) != 2 {
		return nil
	}
	directoryID, err := uuid.Parse(parts[0])
	if err != nil || directoryID != scan.ID {
		// This fallback is for one-shot uploads, whose directory is the scan
		// UUID. Resumable uploads are cleaned through their session row.
		return nil
	}
	return os.RemoveAll(filepath.Dir(filepath.Clean(scan.ImageLocation)))
}

func deleteScanRecords(ctx context.Context, db bun.IDB, scanIDs []uuid.UUID) error {
	if len(scanIDs) == 0 {
		return nil
	}

	if err := scanner.LockVulnerabilityMutationScans(ctx, db, scanIDs); err != nil {
		return fmt.Errorf("lock vulnerability mutations before scan deletion: %w", err)
	}
	if err := deleteScanFindingDependents(ctx, db, scanIDs); err != nil {
		return err
	}
	if err := deleteScanSBOMDependents(ctx, db, scanIDs); err != nil {
		return err
	}
	if err := clearScanReferences(ctx, db, scanIDs); err != nil {
		return err
	}

	for _, table := range []string{
		"archive_upload_sessions",
		"comments",
		"scan_intelligence_versions",
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
		exists, err := scanDeletionColumnExists(ctx, db, table, "scan_id")
		if err != nil {
			return fmt.Errorf("check %s.scan_id: %w", table, err)
		}
		if !exists {
			continue
		}

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

// deleteScanFindingDependents keeps deletion reliable on upgraded databases
// whose older intelligence constraints may not have ON DELETE CASCADE.
func deleteScanFindingDependents(ctx context.Context, db bun.IDB, scanIDs []uuid.UUID) error {
	for _, relation := range []struct {
		table  string
		column string
	}{
		{table: "vulnerability_posture_events", column: "finding_id"},
		{table: "vulnerability_postures", column: "finding_id"},
		{table: "vulnerability_intelligence_evidence", column: "finding_id"},
		{table: "vulnerability_component_links", column: "vulnerability_id"},
	} {
		exists, err := scanDeletionColumnExists(ctx, db, relation.table, relation.column)
		if err != nil {
			return fmt.Errorf("check %s.%s: %w", relation.table, relation.column, err)
		}
		if !exists {
			continue
		}
		if _, err := db.NewDelete().
			TableExpr(relation.table).
			Where(relation.column+" IN (SELECT id FROM vulnerabilities WHERE scan_id IN (?))", bun.In(scanIDs)).
			Exec(ctx); err != nil {
			return fmt.Errorf("delete %s: %w", relation.table, err)
		}
	}

	// Early versions of vulnerability intelligence stored the scan reference
	// directly on posture rows, while finding references could be absent. Delete
	// those rows explicitly so their legacy foreign key cannot block the scan.
	postureScanIDExists, err := scanDeletionColumnExists(ctx, db, "vulnerability_postures", "scan_id")
	if err != nil {
		return fmt.Errorf("check vulnerability_postures.scan_id: %w", err)
	}
	if postureScanIDExists {
		if _, err := db.NewDelete().
			TableExpr("vulnerability_postures").
			Where("scan_id IN (?)", bun.In(scanIDs)).
			Exec(ctx); err != nil {
			return fmt.Errorf("delete vulnerability_postures by scan: %w", err)
		}
	}
	return nil
}

// deleteScanSBOMDependents handles installations created before all SBOM graph
// foreign keys consistently cascaded.
func deleteScanSBOMDependents(ctx context.Context, db bun.IDB, scanIDs []uuid.UUID) error {
	exists, err := scanDeletionColumnExists(ctx, db, "sbom_dependencies", "document_id")
	if err != nil {
		return fmt.Errorf("check sbom_dependencies.document_id: %w", err)
	}
	if !exists {
		return nil
	}
	_, err = db.NewDelete().TableExpr("sbom_dependencies").Where(`
		document_id IN (SELECT id FROM sbom_documents WHERE scan_id IN (?))
		OR from_component_id IN (SELECT id FROM sbom_components WHERE scan_id IN (?))
		OR to_component_id IN (SELECT id FROM sbom_components WHERE scan_id IN (?))
	`, bun.In(scanIDs), bun.In(scanIDs), bun.In(scanIDs)).Exec(ctx)
	if err != nil {
		return fmt.Errorf("delete sbom_dependencies: %w", err)
	}
	return nil
}

// clearScanReferences preserves records that outlive an individual scan while
// preventing legacy NO ACTION foreign keys from blocking deletion.
func clearScanReferences(ctx context.Context, db bun.IDB, scanIDs []uuid.UUID) error {
	for _, relation := range []struct {
		table  string
		column string
	}{
		{table: "watchlist_items", column: "last_scan_id"},
		{table: "git_repository_run_images", column: "scan_id"},
	} {
		exists, err := scanDeletionColumnExists(ctx, db, relation.table, relation.column)
		if err != nil {
			return fmt.Errorf("check %s.%s: %w", relation.table, relation.column, err)
		}
		if !exists {
			continue
		}
		if _, err := db.NewUpdate().
			TableExpr(relation.table).
			Set(relation.column+" = NULL").
			Where(relation.column+" IN (?)", bun.In(scanIDs)).
			Exec(ctx); err != nil {
			return fmt.Errorf("clear %s.%s: %w", relation.table, relation.column, err)
		}
	}
	return nil
}

// scanDeletionColumnExists keeps scan deletion compatible with installations
// upgraded from older schemas. CREATE TABLE IF NOT EXISTS migrations can leave
// a legacy table without a column added by a later model, so checking only the
// table is not sufficient before issuing a cleanup statement.
func scanDeletionColumnExists(ctx context.Context, db bun.IDB, table, column string) (bool, error) {
	var exists bool
	if err := db.NewRaw(`
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = current_schema()
			  AND table_name = ?
			  AND column_name = ?
		)
	`, table, column).Scan(ctx, &exists); err != nil {
		return false, err
	}
	return exists, nil
}
