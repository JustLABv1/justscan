package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`ALTER TABLE status_page_git_repository_sources ADD COLUMN IF NOT EXISTS image_names JSONB NOT NULL DEFAULT '[]'`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 90 status page Git source image names: %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewRaw(`ALTER TABLE status_page_git_repository_sources DROP COLUMN IF EXISTS image_names`).Exec(ctx)
		return err
	})
}
