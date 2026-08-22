package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Migration 107 repairs the other side of the historical duplicate 79
// identifier. A legacy bun_migrations row does not tell us which 79 function
// ran, so this idempotent schema reconciliation guarantees that the removed
// pipeline verdict column is absent without replaying any data migration.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		exists, err := db.NewSelect().Table("information_schema.tables").
			Where("table_name = ?", "pipeline_scan_requests").Exists(ctx)
		if err != nil {
			return fmt.Errorf("migration 107 inspect pipeline scan requests: %w", err)
		}
		if !exists {
			return nil
		}
		if _, err := db.NewRaw(`ALTER TABLE pipeline_scan_requests DROP COLUMN IF EXISTS verdict_config`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 107 remove pipeline verdict config repair: %w", err)
		}
		return nil
	}, func(context.Context, *bun.DB) error {
		// The column was intentionally removed and its old values cannot be
		// reconstructed safely during rollback.
		return nil
	})
}
