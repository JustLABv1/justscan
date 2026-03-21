package migrations

import (
	"context"
	"fmt"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, table := range []interface{}{
			(*models.StatusPage)(nil),
			(*models.StatusPageTarget)(nil),
			(*models.StatusPageUpdate)(nil),
		} {
			if _, err := db.NewCreateTable().Model(table).IfNotExists().Exec(ctx); err != nil {
				return fmt.Errorf("migration 22 (create status page tables): %w", err)
			}
		}

		queries := []string{
			`CREATE UNIQUE INDEX IF NOT EXISTS status_pages_slug_idx ON status_pages (slug)`,
			`CREATE INDEX IF NOT EXISTS status_pages_owner_user_id_idx ON status_pages (owner_user_id)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS status_page_targets_page_image_idx ON status_page_targets (page_id, image_name, image_tag)`,
			`CREATE INDEX IF NOT EXISTS status_page_updates_page_id_idx ON status_page_updates (page_id, created_at DESC)`,
		}
		for _, query := range queries {
			if _, err := db.NewRaw(query).Exec(ctx); err != nil {
				return fmt.Errorf("migration 22 (create status page index): %w", err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, table := range []interface{}{
			(*models.StatusPageUpdate)(nil),
			(*models.StatusPageTarget)(nil),
			(*models.StatusPage)(nil),
		} {
			if _, err := db.NewDropTable().Model(table).IfExists().Cascade().Exec(ctx); err != nil {
				return fmt.Errorf("migration 22 (drop status page tables): %w", err)
			}
		}
		return nil
	})
}
