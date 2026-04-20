package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS xray_request_logs (
				id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
				scan_id     uuid,
				registry_id uuid,
				method      text        NOT NULL,
				endpoint    text        NOT NULL,
				status_code int         NOT NULL,
				duration_ms int         NOT NULL,
				error       text,
				created_at  timestamptz NOT NULL DEFAULT now()
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 45 (xray_request_logs table): %w", err)
		}

		if _, err := db.NewRaw(`
			CREATE INDEX IF NOT EXISTS xray_request_logs_created_at_idx ON xray_request_logs (created_at DESC)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 45 (xray_request_logs created_at index): %w", err)
		}

		if _, err := db.NewRaw(`
			CREATE INDEX IF NOT EXISTS xray_request_logs_scan_id_idx ON xray_request_logs (scan_id)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 45 (xray_request_logs scan_id index): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw("DROP TABLE IF EXISTS xray_request_logs").Exec(ctx) //nolint:errcheck
		return nil
	})
}
