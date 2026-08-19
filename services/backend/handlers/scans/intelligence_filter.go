package scans

import (
	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

// scanIntelligenceFilterCondition is shared by scan, artifact, and image
// overview endpoints. scanExpr is always an internal SQL expression supplied
// by this package, never a user-provided value.
func scanIntelligenceFilterCondition(scanExpr, filter string) (string, []interface{}, bool) {
	prefix := "EXISTS (SELECT 1 FROM vulnerabilities AS v JOIN vulnerability_postures AS p ON p.finding_id = v.id JOIN scans AS intelligence_scan ON intelligence_scan.id = v.scan_id WHERE v.scan_id::text = " + scanExpr + "::text AND (p.change_event_id IS NOT NULL OR (intelligence_scan.completed_at IS NOT NULL AND p.observed_at > intelligence_scan.completed_at)) AND "
	switch filter {
	case "changed":
		return prefix + "p.state IS NOT NULL AND p.state <> ?)", []interface{}{models.PostureStateUnchanged}, true
	case "confirmation_pending", "needs_rescan":
		return prefix + `(
			p.state IN (?)
			OR p.cve_state IN (?)
			OR COALESCE(jsonb_array_length(p.conflict_sources), 0) > 0
		))`, []interface{}{
				bun.In([]string{models.PostureStateDisputed, models.PostureStateNeedsRescan}),
				bun.In([]string{models.IntelligenceCVEStateDisputed, models.IntelligenceCVEStateUnknown}),
			}, true
	default:
		return "", nil, false
	}
}
