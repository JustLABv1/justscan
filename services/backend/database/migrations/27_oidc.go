package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		// Add oidc_subject column
		exists, err := columnExists(ctx, db, "users", "oidc_subject")
		if err != nil {
			return fmt.Errorf("migration 27 (check oidc_subject column): %w", err)
		}
		if !exists {
			if _, err := db.NewRaw(`ALTER TABLE users ADD COLUMN oidc_subject TEXT UNIQUE`).Exec(ctx); err != nil {
				return fmt.Errorf("migration 27 (add oidc_subject column): %w", err)
			}
		}

		// Add auth_type column
		exists, err = columnExists(ctx, db, "users", "auth_type")
		if err != nil {
			return fmt.Errorf("migration 27 (check auth_type column): %w", err)
		}
		if !exists {
			if _, err := db.NewRaw(`ALTER TABLE users ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'local'`).Exec(ctx); err != nil {
				return fmt.Errorf("migration 27 (add auth_type column): %w", err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		exists, err := columnExists(ctx, db, "users", "oidc_subject")
		if err != nil {
			return fmt.Errorf("migration 27 rollback (check oidc_subject column): %w", err)
		}
		if exists {
			if _, err := db.NewRaw(`ALTER TABLE users DROP COLUMN oidc_subject`).Exec(ctx); err != nil {
				return fmt.Errorf("migration 27 rollback (drop oidc_subject column): %w", err)
			}
		}

		exists, err = columnExists(ctx, db, "users", "auth_type")
		if err != nil {
			return fmt.Errorf("migration 27 rollback (check auth_type column): %w", err)
		}
		if exists {
			if _, err := db.NewRaw(`ALTER TABLE users DROP COLUMN auth_type`).Exec(ctx); err != nil {
				return fmt.Errorf("migration 27 rollback (drop auth_type column): %w", err)
			}
		}

		return nil
	})
}
