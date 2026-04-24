package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`CREATE TABLE IF NOT EXISTS org_members (
				org_id UUID NOT NULL,
				user_id UUID NOT NULL,
				role TEXT NOT NULL DEFAULT 'member',
				joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				PRIMARY KEY (org_id, user_id)
			)`,
			`CREATE TABLE IF NOT EXISTS org_invites (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				org_id UUID NOT NULL,
				email TEXT NOT NULL,
				role TEXT NOT NULL DEFAULT 'member',
				token VARCHAR(64) NOT NULL UNIQUE,
				invited_by_user_id UUID NOT NULL,
				accepted_by_user_id UUID NULL,
				accepted_at TIMESTAMPTZ NULL,
				revoked_at TIMESTAMPTZ NULL,
				expires_at TIMESTAMPTZ NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE INDEX IF NOT EXISTS org_members_user_id_idx ON org_members (user_id)`,
			`CREATE INDEX IF NOT EXISTS org_invites_org_id_idx ON org_invites (org_id)`,
			`CREATE INDEX IF NOT EXISTS org_invites_email_idx ON org_invites (lower(email))`,
			`INSERT INTO org_members (org_id, user_id, role, joined_at, created_at, updated_at)
			 SELECT id, created_by_id, 'owner', now(), now(), now()
			 FROM orgs
			 ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner', updated_at = now()`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 39: %w", err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`DROP TABLE IF EXISTS org_invites`,
			`DROP TABLE IF EXISTS org_members`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}
