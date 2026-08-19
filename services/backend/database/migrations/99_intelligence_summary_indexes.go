package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Migration 99 adds the scan-oriented lookup used by list, watchlist, and
// dashboard intelligence summaries and filters.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`CREATE INDEX IF NOT EXISTS idx_vulnerabilities_scan_id_id ON vulnerabilities(scan_id, id)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 99 intelligence summary indexes: %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`DROP INDEX IF EXISTS idx_vulnerabilities_scan_id_id`).Exec(ctx); err != nil {
			return err
		}
		return nil
	})
}
