package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Individual system registries can be hidden per workspace without changing
// the platform-wide registry configuration.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`CREATE TABLE IF NOT EXISTS workspace_hidden_system_registries (
			workspace_key TEXT NOT NULL,
			registry_id UUID NOT NULL REFERENCES registries(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (workspace_key, registry_id)
		)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 114 (create workspace hidden system registries): %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewRaw(`DROP TABLE IF EXISTS workspace_hidden_system_registries`).Exec(ctx)
		return err
	})
}
