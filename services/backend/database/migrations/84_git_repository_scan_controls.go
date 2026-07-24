package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`ALTER TABLE git_repository_runs ADD COLUMN IF NOT EXISTS requested_images JSONB NOT NULL DEFAULT '[]'`,
			`CREATE TABLE IF NOT EXISTS git_repository_image_exclusions (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(), repository_id UUID NOT NULL REFERENCES git_repositories(id) ON DELETE CASCADE,
				full_ref TEXT NOT NULL, created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(repository_id, full_ref)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_git_repository_image_exclusions_repository ON git_repository_image_exclusions(repository_id)`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 84 Git repository scan controls: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`DROP TABLE IF EXISTS git_repository_image_exclusions`,
			`ALTER TABLE git_repository_runs DROP COLUMN IF EXISTS requested_images`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}
