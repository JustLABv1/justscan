package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		exists, err := columnExists(ctx, db, "users", "workspace_tour_completed_at")
		if err != nil {
			return fmt.Errorf("migration 69 (check users.workspace_tour_completed_at): %w", err)
		}
		if exists {
			return nil
		}

		if _, err := db.NewRaw(`ALTER TABLE users ADD COLUMN workspace_tour_completed_at TIMESTAMPTZ`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 69 (add users.workspace_tour_completed_at): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`ALTER TABLE users DROP COLUMN IF EXISTS workspace_tour_completed_at`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 69 rollback (drop users.workspace_tour_completed_at): %w", err)
		}
		return nil
	})
}
