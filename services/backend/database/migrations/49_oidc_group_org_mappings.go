package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS oidc_group_org_mappings (
				id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				provider_name    TEXT NOT NULL REFERENCES oidc_providers(name) ON DELETE CASCADE,
				oidc_group       TEXT NOT NULL,
				org_id           UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
				role             TEXT NOT NULL DEFAULT 'viewer',
				auto_create_org  BOOLEAN NOT NULL DEFAULT false,
				remove_on_unsync BOOLEAN NOT NULL DEFAULT true,
				created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
				UNIQUE (provider_name, oidc_group, org_id)
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 49 (oidc_group_org_mappings): %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewRaw(`DROP TABLE IF EXISTS oidc_group_org_mappings CASCADE`).Exec(ctx)
		return err
	})
}
