package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			ALTER TABLE org_members
				ADD COLUMN IF NOT EXISTS oidc_synced   BOOLEAN NOT NULL DEFAULT false,
				ADD COLUMN IF NOT EXISTS oidc_provider TEXT NOT NULL DEFAULT ''
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 50 (org_members oidc columns): %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw(`ALTER TABLE org_members DROP COLUMN IF EXISTS oidc_synced`).Exec(ctx)   //nolint:errcheck
		db.NewRaw(`ALTER TABLE org_members DROP COLUMN IF EXISTS oidc_provider`).Exec(ctx) //nolint:errcheck
		return nil
	})
}
