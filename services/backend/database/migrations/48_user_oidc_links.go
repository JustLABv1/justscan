package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		// Create user_oidc_links to support multiple OIDC providers per user.
		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS user_oidc_links (
				user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				provider_name TEXT NOT NULL REFERENCES oidc_providers(name) ON DELETE CASCADE,
				oidc_subject  TEXT NOT NULL,
				linked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
				PRIMARY KEY (provider_name, oidc_subject)
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 48 (user_oidc_links): %w", err)
		}
		if _, err := db.NewRaw(`
			CREATE UNIQUE INDEX IF NOT EXISTS user_oidc_links_user_provider
			ON user_oidc_links (user_id, provider_name)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 48 (user_oidc_links index): %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewRaw(`DROP TABLE IF EXISTS user_oidc_links CASCADE`).Exec(ctx)
		return err
	})
}
