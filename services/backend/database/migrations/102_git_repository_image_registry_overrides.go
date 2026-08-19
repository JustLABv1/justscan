package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`ALTER TABLE git_repository_run_images
				ADD COLUMN IF NOT EXISTS registry_id UUID NULL REFERENCES registries(id) ON DELETE SET NULL`,
			`CREATE TABLE IF NOT EXISTS git_repository_image_registry_overrides (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				repository_id UUID NOT NULL REFERENCES git_repositories(id) ON DELETE CASCADE,
				full_ref TEXT NOT NULL,
				registry_id UUID NOT NULL REFERENCES registries(id) ON DELETE CASCADE,
				created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE(repository_id, full_ref)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_git_repository_image_registry_overrides_repository
				ON git_repository_image_registry_overrides(repository_id, full_ref)`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 102 Git repository image registry overrides: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`DROP TABLE IF EXISTS git_repository_image_registry_overrides`,
			`ALTER TABLE git_repository_run_images DROP COLUMN IF EXISTS registry_id`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}
