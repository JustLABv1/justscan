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
			ADD COLUMN IF NOT EXISTS helm_chart_name TEXT NOT NULL DEFAULT '',
			ADD COLUMN IF NOT EXISTS helm_chart_version TEXT NOT NULL DEFAULT ''
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 24 (helm chart metadata): %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw("ALTER TABLE scans DROP COLUMN IF EXISTS helm_chart_name, DROP COLUMN IF EXISTS helm_chart_version").Exec(ctx) //nolint:errcheck
		return nil
	})
}
