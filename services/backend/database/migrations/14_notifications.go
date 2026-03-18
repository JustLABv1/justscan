package migrations

import (
	"context"
	"fmt"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		// notification_channels table
		if _, err := db.NewCreateTable().
			Model((*models.NotificationChannel)(nil)).
			IfNotExists().
			Exec(ctx); err != nil {
			return fmt.Errorf("migration 14 (notification_channels): %w", err)
		}

		// Default rate limit setting
		if _, err := db.NewRaw(`
			INSERT INTO system_settings (key, value)
			VALUES ('public_scan_rate_limit', '5')
			ON CONFLICT (key) DO NOTHING
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 14 (rate_limit setting): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewDropTable().Model((*models.NotificationChannel)(nil)).IfExists().Cascade().Exec(ctx) //nolint:errcheck
		db.NewRaw("DELETE FROM system_settings WHERE key = 'public_scan_rate_limit'").Exec(ctx)    //nolint:errcheck
		return nil
	})
}
