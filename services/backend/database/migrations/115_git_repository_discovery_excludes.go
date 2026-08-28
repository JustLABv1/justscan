package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Repository discovery exclusions are persisted as ordered JSON patterns so
// they can be reviewed and edited without introducing another child resource.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`ALTER TABLE git_repositories
			ADD COLUMN IF NOT EXISTS discovery_excludes JSONB NOT NULL DEFAULT '[]'`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 115 Git repository discovery exclusions: %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`ALTER TABLE git_repositories DROP COLUMN IF EXISTS discovery_excludes`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 115 Git repository discovery exclusions rollback: %w", err)
		}
		return nil
	})
}
