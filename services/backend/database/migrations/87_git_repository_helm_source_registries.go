package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`ALTER TABLE git_repository_helm_sources
			 ADD COLUMN IF NOT EXISTS dependency_registry_id UUID NULL REFERENCES registries(id) ON DELETE SET NULL`,
			`CREATE INDEX IF NOT EXISTS idx_git_repository_helm_sources_dependency_registry
			 ON git_repository_helm_sources(dependency_registry_id)`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 87 Git repository Helm source registries: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`DROP INDEX IF EXISTS idx_git_repository_helm_sources_dependency_registry`).Exec(ctx); err != nil {
			return err
		}
		_, err := db.NewRaw(`ALTER TABLE git_repository_helm_sources DROP COLUMN IF EXISTS dependency_registry_id`).Exec(ctx)
		return err
	})
}
