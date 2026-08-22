package migrations

import (
	"context"
	"fmt"

	vulnerabilityintelligence "justscan-backend/functions/vulnerabilityintelligence"

	"github.com/uptrace/bun"
)

// Remove derived postures that were already known when their scan completed.
// They can be rebuilt from immutable evidence if newer intelligence arrives.
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
