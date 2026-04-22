package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`ALTER TABLE oidc_providers ADD COLUMN IF NOT EXISTS included_groups TEXT[] NOT NULL DEFAULT '{}'`,
			`ALTER TABLE oidc_providers ADD COLUMN IF NOT EXISTS excluded_groups TEXT[] NOT NULL DEFAULT '{}'`,
			`ALTER TABLE oidc_group_org_mappings ADD COLUMN IF NOT EXISTS effect TEXT NOT NULL DEFAULT 'allow'`,
			`UPDATE oidc_group_org_mappings SET effect = 'allow' WHERE effect = ''`,
			`DROP INDEX IF EXISTS oidc_group_org_mappings_rule_key`,
			`CREATE UNIQUE INDEX IF NOT EXISTS oidc_group_org_mappings_rule_key ON oidc_group_org_mappings (provider_name, effect, claim_type, match_type, match_value, provisioning_mode, COALESCE(org_id::text, ''), COALESCE(org_name_template, ''))`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 53 (apply schema change %q): %w", statement, err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		rollbackStatements := []string{
			`DROP INDEX IF EXISTS oidc_group_org_mappings_rule_key`,
			`ALTER TABLE oidc_group_org_mappings DROP COLUMN IF EXISTS effect`,
			`ALTER TABLE oidc_providers DROP COLUMN IF EXISTS included_groups`,
			`ALTER TABLE oidc_providers DROP COLUMN IF EXISTS excluded_groups`,
			`CREATE UNIQUE INDEX IF NOT EXISTS oidc_group_org_mappings_rule_key ON oidc_group_org_mappings (provider_name, claim_type, match_type, match_value, provisioning_mode, COALESCE(org_id::text, ''), COALESCE(org_name_template, ''))`,
		}

		for _, statement := range rollbackStatements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}

		return nil
	})
}
