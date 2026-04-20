package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			ALTER TABLE registries
				ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 51 (registries is_default): %w", err)
		}
		// Partial unique index: only one registry can be the default.
		if _, err := db.NewRaw(`
			CREATE UNIQUE INDEX IF NOT EXISTS registries_single_default
			ON registries (is_default) WHERE is_default = true
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 51 (registries_single_default index): %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw(`DROP INDEX IF EXISTS registries_single_default`).Exec(ctx)          //nolint:errcheck
		db.NewRaw(`ALTER TABLE registries DROP COLUMN IF EXISTS is_default`).Exec(ctx) //nolint:errcheck
		return nil
	})
}
