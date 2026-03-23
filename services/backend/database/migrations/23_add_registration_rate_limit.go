package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			INSERT INTO system_settings (key, value)
			VALUES ('register_rate_limit', '10')
			ON CONFLICT (key) DO NOTHING
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 23 (register_rate_limit setting): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw("DELETE FROM system_settings WHERE key = 'register_rate_limit'").Exec(ctx) //nolint:errcheck
		return nil
	})
}
