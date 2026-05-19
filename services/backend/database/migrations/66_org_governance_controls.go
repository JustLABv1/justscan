package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			ALTER TABLE orgs
				ADD COLUMN IF NOT EXISTS is_active bool NOT NULL DEFAULT true,
				ADD COLUMN IF NOT EXISTS allow_image_scans bool NOT NULL DEFAULT true,
				ADD COLUMN IF NOT EXISTS allow_helm_scans bool NOT NULL DEFAULT true,
				ADD COLUMN IF NOT EXISTS allow_rescans bool NOT NULL DEFAULT true,
				ADD COLUMN IF NOT EXISTS allow_member_invites bool NOT NULL DEFAULT true,
				ADD COLUMN IF NOT EXISTS allow_org_tokens bool NOT NULL DEFAULT true
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 66 (org governance controls): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw(`
			ALTER TABLE orgs
				DROP COLUMN IF EXISTS is_active,
				DROP COLUMN IF EXISTS allow_image_scans,
				DROP COLUMN IF EXISTS allow_helm_scans,
				DROP COLUMN IF EXISTS allow_rescans,
				DROP COLUMN IF EXISTS allow_member_invites,
				DROP COLUMN IF EXISTS allow_org_tokens
		`).Exec(ctx) //nolint:errcheck
		return nil
	})
}
