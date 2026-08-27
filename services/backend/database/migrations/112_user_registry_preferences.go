package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Each user chooses their own default from the registries they can access.
// This intentionally does not reuse registries.is_default, which remains the
// platform administrator's system-registry setting.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`CREATE TABLE IF NOT EXISTS user_registry_preferences (
			user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			registry_id UUID NOT NULL REFERENCES registries(id) ON DELETE CASCADE,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 112 (create user registry preferences): %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewRaw(`DROP TABLE IF EXISTS user_registry_preferences`).Exec(ctx)
		return err
	})
}
