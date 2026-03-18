package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		// Make user_id nullable so anonymous public scans don't need a user
		if _, err := db.NewRaw(
			"ALTER TABLE scans ALTER COLUMN user_id DROP NOT NULL",
		).Exec(ctx); err != nil {
			return fmt.Errorf("migration 12 (user_id nullable): %w", err)
		}

		// System settings table for admin-controlled feature flags
		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS system_settings (
				key         text        PRIMARY KEY,
				value       text        NOT NULL DEFAULT '',
				updated_at  timestamptz NOT NULL DEFAULT now()
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 12 (system_settings): %w", err)
		}

		// Default: public scanning is enabled
		if _, err := db.NewRaw(`
			INSERT INTO system_settings (key, value)
			VALUES ('public_scan_enabled', 'true')
			ON CONFLICT (key) DO NOTHING
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 12 (default setting): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw("DROP TABLE IF EXISTS system_settings").Exec(ctx) //nolint:errcheck
		return nil
	})
}
