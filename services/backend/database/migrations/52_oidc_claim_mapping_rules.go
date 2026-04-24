package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		matchValueExists, err := columnExists(ctx, db, "oidc_group_org_mappings", "match_value")
		if err != nil {
			return fmt.Errorf("migration 52 (check oidc_group_org_mappings.match_value): %w", err)
		}
		legacyGroupExists, err := columnExists(ctx, db, "oidc_group_org_mappings", "oidc_group")
		if err != nil {
			return fmt.Errorf("migration 52 (check oidc_group_org_mappings.oidc_group): %w", err)
		}
		if !matchValueExists && legacyGroupExists {
			if _, err := db.NewRaw(`ALTER TABLE oidc_group_org_mappings RENAME COLUMN oidc_group TO match_value`).Exec(ctx); err != nil {
				return fmt.Errorf("migration 52 (rename oidc_group to match_value): %w", err)
			}
		}

		recreateMissingExists, err := columnExists(ctx, db, "oidc_group_org_mappings", "recreate_missing_org")
		if err != nil {
			return fmt.Errorf("migration 52 (check oidc_group_org_mappings.recreate_missing_org): %w", err)
		}
		legacyAutoCreateExists, err := columnExists(ctx, db, "oidc_group_org_mappings", "auto_create_org")
		if err != nil {
			return fmt.Errorf("migration 52 (check oidc_group_org_mappings.auto_create_org): %w", err)
		}
		if !recreateMissingExists && legacyAutoCreateExists {
			if _, err := db.NewRaw(`ALTER TABLE oidc_group_org_mappings RENAME COLUMN auto_create_org TO recreate_missing_org`).Exec(ctx); err != nil {
				return fmt.Errorf("migration 52 (rename auto_create_org to recreate_missing_org): %w", err)
			}
		}

		statements := []string{
			`ALTER TABLE oidc_group_org_mappings ADD COLUMN IF NOT EXISTS claim_type TEXT NOT NULL DEFAULT 'group'`,
			`ALTER TABLE oidc_group_org_mappings ADD COLUMN IF NOT EXISTS match_type TEXT NOT NULL DEFAULT 'exact'`,
			`ALTER TABLE oidc_group_org_mappings ADD COLUMN IF NOT EXISTS provisioning_mode TEXT NOT NULL DEFAULT 'existing_org'`,
			`ALTER TABLE oidc_group_org_mappings ADD COLUMN IF NOT EXISTS org_name_template TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE oidc_group_org_mappings ADD COLUMN IF NOT EXISTS recreate_missing_org BOOLEAN NOT NULL DEFAULT false`,
			`ALTER TABLE oidc_group_org_mappings ALTER COLUMN org_id DROP NOT NULL`,
			`UPDATE oidc_group_org_mappings SET org_name_template = '{claim}' WHERE recreate_missing_org = true AND org_name_template = ''`,
			`ALTER TABLE oidc_group_org_mappings DROP CONSTRAINT IF EXISTS oidc_group_org_mappings_provider_name_oidc_group_org_id_key`,
			`CREATE UNIQUE INDEX IF NOT EXISTS oidc_group_org_mappings_rule_key ON oidc_group_org_mappings (provider_name, claim_type, match_type, match_value, provisioning_mode, COALESCE(org_id::text, ''), COALESCE(org_name_template, ''))`,
			`ALTER TABLE org_members ADD COLUMN IF NOT EXISTS oidc_mapping_id UUID REFERENCES oidc_group_org_mappings(id) ON DELETE SET NULL`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 52 (apply schema change %q): %w", statement, err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		rollbackStatements := []string{
			`ALTER TABLE org_members DROP COLUMN IF EXISTS oidc_mapping_id`,
			`DROP INDEX IF EXISTS oidc_group_org_mappings_rule_key`,
			`ALTER TABLE oidc_group_org_mappings DROP COLUMN IF EXISTS claim_type`,
			`ALTER TABLE oidc_group_org_mappings DROP COLUMN IF EXISTS match_type`,
			`ALTER TABLE oidc_group_org_mappings DROP COLUMN IF EXISTS provisioning_mode`,
			`ALTER TABLE oidc_group_org_mappings DROP COLUMN IF EXISTS org_name_template`,
		}
		for _, statement := range rollbackStatements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}

		recreateMissingExists, err := columnExists(ctx, db, "oidc_group_org_mappings", "recreate_missing_org")
		if err != nil {
			return err
		}
		legacyAutoCreateExists, err := columnExists(ctx, db, "oidc_group_org_mappings", "auto_create_org")
		if err != nil {
			return err
		}
		if recreateMissingExists && !legacyAutoCreateExists {
			if _, err := db.NewRaw(`ALTER TABLE oidc_group_org_mappings RENAME COLUMN recreate_missing_org TO auto_create_org`).Exec(ctx); err != nil {
				return err
			}
		}

		matchValueExists, err := columnExists(ctx, db, "oidc_group_org_mappings", "match_value")
		if err != nil {
			return err
		}
		legacyGroupExists, err := columnExists(ctx, db, "oidc_group_org_mappings", "oidc_group")
		if err != nil {
			return err
		}
		if matchValueExists && !legacyGroupExists {
			if _, err := db.NewRaw(`ALTER TABLE oidc_group_org_mappings RENAME COLUMN match_value TO oidc_group`).Exec(ctx); err != nil {
				return err
			}
		}

		return nil
	})
}