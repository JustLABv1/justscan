package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`CREATE INDEX IF NOT EXISTS idx_scans_image_name_tag_created_at ON scans (image_name, image_tag, created_at DESC, id DESC)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 75 create scan artifact index failed: %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`DROP INDEX IF EXISTS idx_scans_image_name_tag_created_at`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 75 drop scan artifact index failed: %w", err)
		}
		return nil
	})
}
