package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			ALTER TABLE scans
			ADD COLUMN IF NOT EXISTS grype_version TEXT NOT NULL DEFAULT ''
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 31 (add scans.grype_version): %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			ALTER TABLE scans
			DROP COLUMN IF EXISTS grype_version
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 31 rollback (drop scans.grype_version): %w", err)
		}
		return nil
	})
}
