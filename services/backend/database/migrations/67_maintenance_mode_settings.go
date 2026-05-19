package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			INSERT INTO system_settings (key, value, updated_at)
			VALUES
				('maintenance.enabled', 'false', NOW()),
				('maintenance.message', 'JustScan is currently undergoing maintenance. Please check back shortly.', NOW())
			ON CONFLICT (key) DO NOTHING
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 67 (maintenance settings): %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw(`DELETE FROM system_settings WHERE key IN ('maintenance.enabled', 'maintenance.message')`).Exec(ctx) //nolint:errcheck
		return nil
	})
}
