package compliance

import (
	"context"
	"time"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// LoadIntelligenceSummaries returns one aggregate per requested scan. The
// caller must already have authorized the scan IDs; keeping authorization out
// of this helper lets list, watchlist, and dashboard handlers reuse one batch
// query without introducing row-by-row policy evaluation.
func LoadIntelligenceSummaries(
	ctx context.Context,
	db *bun.DB,
	scanIDs []uuid.UUID,
) (map[uuid.UUID]*models.IntelligenceSummary, error) {
	summaries := make(map[uuid.UUID]*models.IntelligenceSummary, len(scanIDs))
	if len(scanIDs) == 0 {
		return summaries, nil
	}

	type summaryRow struct {
		ScanID               uuid.UUID  `bun:"scan_id"`
		ChangedCVECount      int        `bun:"changed_cve_count"`
		ChangedFindingCount  int        `bun:"changed_finding_count"`
		NeedsValidationCount int        `bun:"needs_validation_count"`
		FixAvailableCount    int        `bun:"fix_available_count"`
		DetectedAt           *time.Time `bun:"detected_at"`
	}

	rows := make([]summaryRow, 0, len(scanIDs))
	postScanChange := "(p.change_event_id IS NOT NULL OR (s.completed_at IS NOT NULL AND p.observed_at > s.completed_at))"
	query := db.NewSelect().
		TableExpr("vulnerabilities AS v").
		ColumnExpr("v.scan_id").
		ColumnExpr(
			"COUNT(DISTINCT v.vuln_id) FILTER (WHERE p.state IS NOT NULL AND p.state <> ? AND "+postScanChange+") AS changed_cve_count",
			models.PostureStateUnchanged,
		).
		ColumnExpr(
			"COUNT(DISTINCT v.id) FILTER (WHERE p.state IS NOT NULL AND p.state <> ? AND "+postScanChange+") AS changed_finding_count",
			models.PostureStateUnchanged,
		).
		ColumnExpr(`COUNT(DISTINCT v.id) FILTER (WHERE `+postScanChange+` AND (
			p.state IN (?)
			OR p.cve_state IN (?)
			OR COALESCE(jsonb_array_length(p.conflict_sources), 0) > 0
		)) AS needs_validation_count`,
			bun.In([]string{models.PostureStateDisputed, models.PostureStateNeedsRescan}),
			bun.In([]string{models.IntelligenceCVEStateDisputed, models.IntelligenceCVEStateUnknown}),
		).
		ColumnExpr(
			"COUNT(DISTINCT v.id) FILTER (WHERE p.state = ? AND "+postScanChange+") AS fix_available_count",
			models.PostureStateFixAvailable,
		).
		ColumnExpr(
			"MAX(GREATEST(p.observed_at, p.updated_at)) FILTER (WHERE p.state IS NOT NULL AND p.state <> ? AND "+postScanChange+") AS detected_at",
			models.PostureStateUnchanged,
		).
		Join("JOIN vulnerability_postures AS p ON p.finding_id = v.id").
		Join("JOIN scans AS s ON s.id = v.scan_id").
		Where("v.scan_id IN (?)", bun.In(scanIDs)).
		GroupExpr("v.scan_id")

	if err := query.Scan(ctx, &rows); err != nil {
		return nil, err
	}

	for _, row := range rows {
		if row.ChangedFindingCount == 0 {
			continue
		}
		state := models.IntelligenceSummaryStateChanged
		if row.NeedsValidationCount > 0 {
			state = models.IntelligenceSummaryStateConfirmationPending
		}
		summaries[row.ScanID] = &models.IntelligenceSummary{
			State:                state,
			ChangedCVECount:      row.ChangedCVECount,
			ChangedFindingCount:  row.ChangedFindingCount,
			NeedsValidationCount: row.NeedsValidationCount,
			FixAvailableCount:    row.FixAvailableCount,
			DetectedAt:           row.DetectedAt,
		}
	}

	return summaries, nil
}
