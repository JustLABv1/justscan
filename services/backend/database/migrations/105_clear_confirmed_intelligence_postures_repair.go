package migrations

import (
	"context"
	"fmt"

	vulnerabilityintelligence "justscan-backend/functions/vulnerabilityintelligence"

	"github.com/uptrace/bun"
)

// Migration 105 removes derived postures that were already known when their
// scan completed. The historical migration used the duplicate identifier 101;
// this predicate is intentionally safe to replay so either legacy branch is
// repaired without relying on an ambiguous migration row.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		condition := vulnerabilityintelligence.PostScanChangeCondition("p", "s")
		if _, err := db.NewRaw(`
			DELETE FROM vulnerability_postures AS p
			USING scans AS s
			WHERE p.scan_id = s.id
			  AND s.completed_at IS NOT NULL
			  AND NOT (` + condition + `)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("clear CVE postures already confirmed by a scan: %w", err)
		}
		return nil
	}, func(context.Context, *bun.DB) error {
		// Vulnerability postures are derived from immutable evidence; there is no
		// safe reason to recreate stale rows during rollback.
		return nil
	})
}
