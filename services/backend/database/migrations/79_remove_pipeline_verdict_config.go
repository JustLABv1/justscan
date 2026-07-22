package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`ALTER TABLE pipeline_scan_requests DROP COLUMN IF EXISTS verdict_config`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 79 remove pipeline verdict config failed: %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`ALTER TABLE pipeline_scan_requests ADD COLUMN IF NOT EXISTS verdict_config JSONB NOT NULL DEFAULT '{}'::jsonb`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 79 restore pipeline verdict config failed: %w", err)
		}
		return nil
	})
}
