package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		exists, err := columnExists(ctx, db, "status_pages", "image_patterns")
		if err != nil {
			return fmt.Errorf("migration 26 (check status page image_patterns column): %w", err)
		}
		if exists {
			return nil
		}

		if _, err := db.NewRaw(`ALTER TABLE status_pages ADD COLUMN image_patterns jsonb NOT NULL DEFAULT '[]'::jsonb`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 26 (add status page image_patterns column): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		exists, err := columnExists(ctx, db, "status_pages", "image_patterns")
		if err != nil {
			return fmt.Errorf("migration 26 (check status page image_patterns column): %w", err)
		}
		if !exists {
			return nil
		}

		if _, err := db.NewRaw(`ALTER TABLE status_pages DROP COLUMN image_patterns`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 26 (drop status page image_patterns column): %w", err)
		}

		return nil
	})
}
