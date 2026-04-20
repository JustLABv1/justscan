package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		defaults := []struct{ key, value string }{
			{"api_log_retention_days", "30"},
			{"xray_log_retention_days", "30"},
		}
		for _, s := range defaults {
			if _, err := db.NewRaw(`
				INSERT INTO system_settings (key, value, updated_at)
				VALUES (?, ?, now())
				ON CONFLICT (key) DO NOTHING
			`, s.key, s.value).Exec(ctx); err != nil {
				return fmt.Errorf("migration 46 (insight settings %s): %w", s.key, err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw(`DELETE FROM system_settings WHERE key IN ('api_log_retention_days','xray_log_retention_days')`).Exec(ctx) //nolint:errcheck
		return nil
	})
}
