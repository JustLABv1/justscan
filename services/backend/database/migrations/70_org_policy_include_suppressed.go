package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			ALTER TABLE org_policies
			ADD COLUMN IF NOT EXISTS include_suppressed BOOLEAN NOT NULL DEFAULT true
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 70: %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			ALTER TABLE org_policies
			DROP COLUMN IF EXISTS include_suppressed
		`).Exec(ctx); err != nil {
			return err
		}
		return nil
	})
}
