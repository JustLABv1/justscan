package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`ALTER TABLE orgs DROP COLUMN IF EXISTS image_patterns`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 76 (remove org image patterns): %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS image_patterns jsonb NOT NULL DEFAULT '[]'`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 76 rollback (restore org image patterns): %w", err)
		}
		return nil
	})
}
