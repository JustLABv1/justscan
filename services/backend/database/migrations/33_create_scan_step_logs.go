package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS scan_step_logs (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
				step TEXT NOT NULL,
				position INT NOT NULL DEFAULT 0,
				started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				completed_at TIMESTAMPTZ,
				output JSONB NOT NULL DEFAULT '[]'::jsonb
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 33 (create scan_step_logs): %w", err)
		}

		if _, err := db.NewRaw(`
			CREATE INDEX IF NOT EXISTS idx_scan_step_logs_scan_id_position
			ON scan_step_logs(scan_id, position)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 33 (index scan_step_logs): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`DROP TABLE IF EXISTS scan_step_logs`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 33 rollback (drop scan_step_logs): %w", err)
		}
		return nil
	})
}
