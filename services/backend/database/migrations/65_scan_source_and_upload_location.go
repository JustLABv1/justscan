package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`ALTER TABLE scans ADD COLUMN IF NOT EXISTS scan_source TEXT NOT NULL DEFAULT 'registry'`,
			`ALTER TABLE scans ADD COLUMN IF NOT EXISTS image_location TEXT NOT NULL DEFAULT ''`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 65: %w", err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`ALTER TABLE scans DROP COLUMN IF EXISTS scan_source`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}

		return nil
	})
}
