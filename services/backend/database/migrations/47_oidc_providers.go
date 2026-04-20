package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS oidc_providers (
				name         TEXT PRIMARY KEY,
				display_name TEXT NOT NULL,
				button_color TEXT NOT NULL DEFAULT '',
				issuer_url   TEXT NOT NULL,
				client_id    TEXT NOT NULL,
				client_secret TEXT NOT NULL DEFAULT '',
				redirect_uri TEXT NOT NULL DEFAULT '',
				scopes       TEXT[] NOT NULL DEFAULT '{}',
				admin_groups TEXT[] NOT NULL DEFAULT '{}',
				admin_roles  TEXT[] NOT NULL DEFAULT '{}',
				groups_claim TEXT NOT NULL DEFAULT 'groups',
				roles_claim  TEXT NOT NULL DEFAULT 'roles',
				enabled      BOOLEAN NOT NULL DEFAULT true,
				sort_order   INT NOT NULL DEFAULT 0,
				created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 47 (oidc_providers): %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewRaw(`DROP TABLE IF EXISTS oidc_providers CASCADE`).Exec(ctx)
		return err
	})
}
