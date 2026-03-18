package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS audit (
				id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id    text        NOT NULL DEFAULT '',
				operation  text        NOT NULL,
				details    text        NOT NULL DEFAULT '',
				created_at timestamptz NOT NULL DEFAULT now()
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 15 (audit table): %w", err)
		}

		if _, err := db.NewRaw(`
			CREATE INDEX IF NOT EXISTS audit_created_at_idx ON audit (created_at DESC)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 15 (audit index): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw("DROP TABLE IF EXISTS audit").Exec(ctx) //nolint:errcheck
		return nil
	})
}
