package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		exists, err := columnExists(ctx, db, "registries", "xray_repository")
		if err != nil {
			return fmt.Errorf("migration 56 (check registries.xray_repository): %w", err)
		}
		if exists {
			return nil
		}

		if _, err := db.NewRaw(`ALTER TABLE registries ADD COLUMN xray_repository TEXT NOT NULL DEFAULT ''`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 56 (add registries.xray_repository): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		exists, err := columnExists(ctx, db, "registries", "xray_repository")
		if err != nil {
			return fmt.Errorf("migration 56 rollback (check registries.xray_repository): %w", err)
		}
		if !exists {
			return nil
		}

		if _, err := db.NewRaw(`ALTER TABLE registries DROP COLUMN xray_repository`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 56 rollback (drop registries.xray_repository): %w", err)
		}
		return nil
	})
}
