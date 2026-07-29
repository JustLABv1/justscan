package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`CREATE TABLE IF NOT EXISTS git_repository_helm_sources (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				repository_id UUID NOT NULL REFERENCES git_repositories(id) ON DELETE CASCADE,
				source_type TEXT NOT NULL,
				chart_repository_id UUID NULL REFERENCES git_repositories(id) ON DELETE CASCADE,
				clone_url TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT 'HEAD',
				auth_type TEXT NOT NULL DEFAULT 'none', username TEXT NOT NULL DEFAULT '', encrypted_credential TEXT NOT NULL DEFAULT '',
				chart_path TEXT NOT NULL, values JSONB NOT NULL DEFAULT '[]', release_name TEXT NOT NULL DEFAULT '',
				created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				CHECK (source_type IN ('local', 'repository', 'url')),
				CHECK ((source_type = 'local' AND chart_repository_id IS NULL AND clone_url = '') OR
				       (source_type = 'repository' AND chart_repository_id IS NOT NULL AND clone_url = '') OR
				       (source_type = 'url' AND chart_repository_id IS NULL AND clone_url <> ''))
			)`,
			`CREATE INDEX IF NOT EXISTS idx_git_repository_helm_sources_repository ON git_repository_helm_sources(repository_id, created_at)`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 86 Git repository Helm sources: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewRaw(`DROP TABLE IF EXISTS git_repository_helm_sources`).Exec(ctx)
		return err
	})
}
