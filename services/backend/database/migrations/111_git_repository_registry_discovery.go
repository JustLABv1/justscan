package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`ALTER TABLE git_repositories
				ADD COLUMN IF NOT EXISTS discovery_registry_id UUID NULL REFERENCES registries(id) ON DELETE SET NULL`,
			`ALTER TABLE git_repositories
				ADD COLUMN IF NOT EXISTS discovery_registry TEXT NOT NULL DEFAULT ''`,
			`CREATE INDEX IF NOT EXISTS idx_git_repositories_discovery_registry
				ON git_repositories(discovery_registry_id)`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 111 Git repository registry discovery: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`DROP INDEX IF EXISTS idx_git_repositories_discovery_registry`,
			`ALTER TABLE git_repositories DROP COLUMN IF EXISTS discovery_registry`,
			`ALTER TABLE git_repositories DROP COLUMN IF EXISTS discovery_registry_id`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 111 Git repository registry discovery rollback: %w", err)
			}
		}
		return nil
	})
}
