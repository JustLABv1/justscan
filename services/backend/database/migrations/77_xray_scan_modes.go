package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`ALTER TABLE registries ADD COLUMN IF NOT EXISTS xray_mode TEXT NOT NULL DEFAULT 'limited'`,
			`ALTER TABLE scans ADD COLUMN IF NOT EXISTS xray_mode TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE scans ADD COLUMN IF NOT EXISTS xray_provider_scanned_at TIMESTAMPTZ`,
		}
		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 77 add Xray scan mode fields failed: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`ALTER TABLE scans DROP COLUMN IF EXISTS xray_provider_scanned_at`,
			`ALTER TABLE scans DROP COLUMN IF EXISTS xray_mode`,
			`ALTER TABLE registries DROP COLUMN IF EXISTS xray_mode`,
		}
		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 77 remove Xray scan mode fields failed: %w", err)
			}
		}
		return nil
	})
}
