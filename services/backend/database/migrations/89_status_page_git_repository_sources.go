package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`CREATE TABLE IF NOT EXISTS status_page_git_repository_sources (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				page_id UUID NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
				repository_id UUID NOT NULL REFERENCES git_repositories(id) ON DELETE RESTRICT,
				display_order INT NOT NULL DEFAULT 0,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				UNIQUE (page_id, repository_id)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_status_page_git_repository_sources_page ON status_page_git_repository_sources(page_id, display_order)`,
			`CREATE INDEX IF NOT EXISTS idx_status_page_git_repository_sources_repository ON status_page_git_repository_sources(repository_id)`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 89 status page Git repository sources: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`DROP INDEX IF EXISTS idx_status_page_git_repository_sources_repository`,
			`DROP INDEX IF EXISTS idx_status_page_git_repository_sources_page`,
			`DROP TABLE IF EXISTS status_page_git_repository_sources`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}
