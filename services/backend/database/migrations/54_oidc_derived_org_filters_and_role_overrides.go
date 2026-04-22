package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`ALTER TABLE oidc_providers ADD COLUMN IF NOT EXISTS included_org_names TEXT[] NOT NULL DEFAULT '{}'`,
			`ALTER TABLE oidc_providers ADD COLUMN IF NOT EXISTS excluded_org_names TEXT[] NOT NULL DEFAULT '{}'`,
			`CREATE TABLE IF NOT EXISTS oidc_org_role_overrides (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				provider_name TEXT NOT NULL REFERENCES oidc_providers(name) ON DELETE CASCADE,
				claim_type TEXT NOT NULL DEFAULT 'group',
				match_type TEXT NOT NULL DEFAULT 'exact',
				match_value TEXT NOT NULL,
				target_type TEXT NOT NULL DEFAULT 'org_id',
				org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
				org_name_template TEXT NOT NULL DEFAULT '',
				role TEXT NOT NULL DEFAULT 'viewer',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS oidc_org_role_overrides_rule_key ON oidc_org_role_overrides (provider_name, claim_type, match_type, match_value, target_type, COALESCE(org_id::text, ''), COALESCE(org_name_template, ''), role)`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 54 (apply schema change %q): %w", statement, err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		rollbackStatements := []string{
			`DROP INDEX IF EXISTS oidc_org_role_overrides_rule_key`,
			`DROP TABLE IF EXISTS oidc_org_role_overrides`,
			`ALTER TABLE oidc_providers DROP COLUMN IF EXISTS included_org_names`,
			`ALTER TABLE oidc_providers DROP COLUMN IF EXISTS excluded_org_names`,
		}

		for _, statement := range rollbackStatements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}

		return nil
	})
}
