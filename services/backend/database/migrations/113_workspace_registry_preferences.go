package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Workspace registry settings are shared by every member of an organization.
// Personal workspaces use a user-scoped key; organization workspaces use the
// organization ID in the key.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`CREATE TABLE IF NOT EXISTS workspace_registry_preferences (
			workspace_key TEXT PRIMARY KEY,
			default_registry_id UUID NULL REFERENCES registries(id) ON DELETE SET NULL,
			hide_system_registries BOOLEAN NOT NULL DEFAULT false,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 113 (create workspace registry preferences): %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewRaw(`DROP TABLE IF EXISTS workspace_registry_preferences`).Exec(ctx)
		return err
	})
}
