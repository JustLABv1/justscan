package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`CREATE TABLE IF NOT EXISTS helm_registry_credentials (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, url TEXT NOT NULL,
				protocol TEXT NOT NULL, auth_type TEXT NOT NULL, username TEXT NOT NULL DEFAULT '',
				encrypted_secret TEXT NOT NULL DEFAULT '', created_by_id UUID NOT NULL REFERENCES users(id),
				owner_type TEXT NOT NULL DEFAULT 'user', owner_user_id UUID NULL REFERENCES users(id),
				owner_org_id UUID NULL REFERENCES orgs(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), health_status TEXT NOT NULL DEFAULT 'unknown',
				health_message TEXT NOT NULL DEFAULT '', last_health_check_at TIMESTAMPTZ NULL,
				CHECK (protocol IN ('oci','http')), CHECK (auth_type IN ('basic','access_token','bearer_token'))
			)`,
			`CREATE INDEX IF NOT EXISTS idx_helm_registry_credentials_owner_user ON helm_registry_credentials(owner_user_id)`,
			`CREATE INDEX IF NOT EXISTS idx_helm_registry_credentials_owner_org ON helm_registry_credentials(owner_org_id)`,
			`CREATE TABLE IF NOT EXISTS org_helm_registry_credentials (
				org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
				helm_registry_credential_id UUID NOT NULL REFERENCES helm_registry_credentials(id) ON DELETE CASCADE,
				PRIMARY KEY (org_id, helm_registry_credential_id)
			)`,
			`ALTER TABLE git_repository_helm_sources ADD COLUMN IF NOT EXISTS helm_registry_credential_id UUID NULL REFERENCES helm_registry_credentials(id) ON DELETE RESTRICT`,
			`CREATE INDEX IF NOT EXISTS idx_git_repository_helm_sources_helm_credential ON git_repository_helm_sources(helm_registry_credential_id)`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 88 Helm registry credentials: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`DROP INDEX IF EXISTS idx_git_repository_helm_sources_helm_credential`,
			`ALTER TABLE git_repository_helm_sources DROP COLUMN IF EXISTS helm_registry_credential_id`,
			`DROP TABLE IF EXISTS org_helm_registry_credentials`,
			`DROP TABLE IF EXISTS helm_registry_credentials`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}
