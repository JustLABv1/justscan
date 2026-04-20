package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS api_request_logs (
				id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id     text,
				method      text        NOT NULL,
				path        text        NOT NULL,
				status_code int         NOT NULL,
				duration_ms int         NOT NULL,
				created_at  timestamptz NOT NULL DEFAULT now()
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 44 (api_request_logs table): %w", err)
		}

		if _, err := db.NewRaw(`
			CREATE INDEX IF NOT EXISTS api_request_logs_created_at_idx ON api_request_logs (created_at DESC)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 44 (api_request_logs index): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw("DROP TABLE IF EXISTS api_request_logs").Exec(ctx) //nolint:errcheck
		return nil
	})
}
