package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`ALTER TABLE git_repositories ADD COLUMN IF NOT EXISTS discovery_mode TEXT NOT NULL DEFAULT 'auto'`,
			`ALTER TABLE git_repositories ADD COLUMN IF NOT EXISTS entrypoints JSONB NOT NULL DEFAULT '[]'`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 82 Git repository discovery: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`ALTER TABLE git_repositories DROP COLUMN IF EXISTS entrypoints`,
			`ALTER TABLE git_repositories DROP COLUMN IF EXISTS discovery_mode`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}
