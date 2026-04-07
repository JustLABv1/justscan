package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS notification_delivery_logs (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
				event TEXT NOT NULL,
				triggered_by TEXT NOT NULL DEFAULT 'dispatch',
				status TEXT NOT NULL,
				error TEXT NOT NULL DEFAULT '',
				details TEXT NOT NULL DEFAULT '',
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 30 (create notification_delivery_logs): %w", err)
		}

		if _, err := db.NewRaw(`CREATE INDEX IF NOT EXISTS idx_notification_delivery_logs_channel_id ON notification_delivery_logs (channel_id)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 30 (create idx_notification_delivery_logs_channel_id): %w", err)
		}
		if _, err := db.NewRaw(`CREATE INDEX IF NOT EXISTS idx_notification_delivery_logs_created_at ON notification_delivery_logs (created_at DESC)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 30 (create idx_notification_delivery_logs_created_at): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`DROP TABLE IF EXISTS notification_delivery_logs`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 30 rollback (drop notification_delivery_logs): %w", err)
		}
		return nil
	})
}
