package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			ALTER TABLE scans
			ADD COLUMN IF NOT EXISTS share_token     VARCHAR(64) UNIQUE DEFAULT NULL,
			ADD COLUMN IF NOT EXISTS share_visibility VARCHAR(20)        DEFAULT NULL
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 18 (scan sharing columns): %w", err)
		}

		if _, err := db.NewRaw(`
			CREATE INDEX IF NOT EXISTS scans_share_token_idx ON scans (share_token)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 18 (scan sharing index): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw("ALTER TABLE scans DROP COLUMN IF EXISTS share_token, DROP COLUMN IF EXISTS share_visibility").Exec(ctx) //nolint:errcheck
		return nil
	})
}
