package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Migration 121 stores the component scope of Xray ignore rules so a rule
// limited to one package does not suppress the same CVE in other packages.
// An empty list keeps the previous behavior: the rule applies to every
// component with that vulnerability ID.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			ALTER TABLE xray_suppressions
			ADD COLUMN IF NOT EXISTS components jsonb NOT NULL DEFAULT '[]'::jsonb
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 121 add xray suppression components: %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewRaw(`ALTER TABLE xray_suppressions DROP COLUMN IF EXISTS components`).Exec(ctx)
		return err
	})
}
