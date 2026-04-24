package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`UPDATE org_members SET role = 'viewer' WHERE role = 'member'`,
			`UPDATE org_invites SET role = 'viewer' WHERE role = 'member'`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 42: %w", err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`UPDATE org_members SET role = 'member' WHERE role = 'viewer'`,
			`UPDATE org_invites SET role = 'member' WHERE role = 'viewer'`,
			`UPDATE org_members SET role = 'member' WHERE role = 'editor'`,
			`UPDATE org_invites SET role = 'member' WHERE role = 'editor'`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 42 rollback: %w", err)
			}
		}

		return nil
	})
}
