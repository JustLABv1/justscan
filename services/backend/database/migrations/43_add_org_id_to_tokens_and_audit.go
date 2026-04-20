package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL`,
			`CREATE INDEX IF NOT EXISTS idx_tokens_org_id ON tokens(org_id) WHERE org_id IS NOT NULL`,
			`ALTER TABLE audit ADD COLUMN IF NOT EXISTS org_id UUID`,
			`CREATE INDEX IF NOT EXISTS idx_audit_org_id ON audit(org_id) WHERE org_id IS NOT NULL`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 43: %w", err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`DROP INDEX IF EXISTS idx_audit_org_id`,
			`ALTER TABLE audit DROP COLUMN IF EXISTS org_id`,
			`DROP INDEX IF EXISTS idx_tokens_org_id`,
			`ALTER TABLE tokens DROP COLUMN IF EXISTS org_id`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 43 rollback: %w", err)
			}
		}

		return nil
	})
}
