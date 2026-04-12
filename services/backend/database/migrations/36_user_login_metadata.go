package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		lastLoginAtExists, err := columnExists(ctx, db, "users", "last_login_at")
		if err != nil {
			return fmt.Errorf("migration 36 (check users.last_login_at): %w", err)
		}
		if !lastLoginAtExists {
			if _, err := db.NewRaw(`ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ`).Exec(ctx); err != nil {
				return fmt.Errorf("migration 36 (add users.last_login_at): %w", err)
			}
		}

		lastLoginMethodExists, err := columnExists(ctx, db, "users", "last_login_method")
		if err != nil {
			return fmt.Errorf("migration 36 (check users.last_login_method): %w", err)
		}
		if !lastLoginMethodExists {
			if _, err := db.NewRaw(`ALTER TABLE users ADD COLUMN last_login_method TEXT NOT NULL DEFAULT ''`).Exec(ctx); err != nil {
				return fmt.Errorf("migration 36 (add users.last_login_method): %w", err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`ALTER TABLE users DROP COLUMN IF EXISTS last_login_at`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 36 rollback (drop users.last_login_at): %w", err)
		}
		if _, err := db.NewRaw(`ALTER TABLE users DROP COLUMN IF EXISTS last_login_method`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 36 rollback (drop users.last_login_method): %w", err)
		}
		return nil
	})
}
