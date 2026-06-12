package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'org_admin'`,
			`UPDATE tokens SET scope = 'org_admin' WHERE scope IS NULL OR scope = ''`,
			`DO $$ BEGIN
				IF NOT EXISTS (
					SELECT 1 FROM pg_constraint WHERE conname = 'tokens_scope_check'
				) THEN
					ALTER TABLE tokens ADD CONSTRAINT tokens_scope_check CHECK (scope IN ('org_admin', 'pipeline_scan'));
				END IF;
			END $$`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 74 org token scopes failed: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`ALTER TABLE tokens DROP CONSTRAINT IF EXISTS tokens_scope_check`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 74 org token scopes rollback failed: %w", err)
		}
		if _, err := db.NewRaw(`ALTER TABLE tokens DROP COLUMN IF EXISTS scope`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 74 org token scopes rollback failed: %w", err)
		}
		return nil
	})
}
