package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`CREATE TABLE IF NOT EXISTS git_repository_image_registry_override_rules (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				repository_id UUID NOT NULL REFERENCES git_repositories(id) ON DELETE CASCADE,
				pattern TEXT NOT NULL,
				registry_id UUID NOT NULL REFERENCES registries(id) ON DELETE CASCADE,
				created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE(repository_id, pattern)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_git_repository_image_registry_override_rules_repository
				ON git_repository_image_registry_override_rules(repository_id, updated_at DESC)`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 117 Git repository image registry override rules: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`DROP TABLE IF EXISTS git_repository_image_registry_override_rules`).Exec(ctx); err != nil {
			return err
		}
		return nil
	})
}
