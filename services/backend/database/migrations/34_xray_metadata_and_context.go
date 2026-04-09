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
			ADD COLUMN IF NOT EXISTS image_config JSONB NOT NULL DEFAULT '{}'::jsonb
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 34 (add scans.image_config): %w", err)
		}

		if _, err := db.NewRaw(`
			ALTER TABLE vulnerabilities
			ADD COLUMN IF NOT EXISTS external_component_id TEXT NOT NULL DEFAULT ''
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 34 (add vulnerabilities.external_component_id): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			ALTER TABLE vulnerabilities
			DROP COLUMN IF EXISTS external_component_id
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 34 rollback (drop vulnerabilities.external_component_id): %w", err)
		}

		if _, err := db.NewRaw(`
			ALTER TABLE scans
			DROP COLUMN IF EXISTS image_config
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 34 rollback (drop scans.image_config): %w", err)
		}

		return nil
	})
}
