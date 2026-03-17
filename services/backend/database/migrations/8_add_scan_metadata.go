package migrations

import (
	"context"
	"fmt"
	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, stmt := range []string{
			"ALTER TABLE scans ADD COLUMN IF NOT EXISTS architecture text NOT NULL DEFAULT ''",
			"ALTER TABLE scans ADD COLUMN IF NOT EXISTS os_family text NOT NULL DEFAULT ''",
			"ALTER TABLE scans ADD COLUMN IF NOT EXISTS os_name text NOT NULL DEFAULT ''",
		} {
			if _, err := db.NewRaw(stmt).Exec(ctx); err != nil {
				return fmt.Errorf("migration 8: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, col := range []string{"architecture", "os_family", "os_name"} {
			if _, err := db.NewRaw("ALTER TABLE scans DROP COLUMN IF EXISTS " + col).Exec(ctx); err != nil {
				return fmt.Errorf("migration 8 rollback: %w", err)
			}
		}
		return nil
	})
}
