package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			ALTER TABLE scans ADD COLUMN IF NOT EXISTS image_location text NOT NULL DEFAULT ''
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 16 (image_location): %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw("ALTER TABLE scans DROP COLUMN IF EXISTS image_location").Exec(ctx) //nolint:errcheck
		return nil
	})
}
