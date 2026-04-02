package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS helm_scan_runs (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id UUID REFERENCES users(id) ON DELETE SET NULL,
				chart_url TEXT NOT NULL DEFAULT '',
				chart_name TEXT NOT NULL DEFAULT '',
				chart_version TEXT NOT NULL DEFAULT '',
				platform TEXT NOT NULL DEFAULT '',
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 25 (create helm_scan_runs table): %w", err)
		}

		if _, err := db.NewRaw(`
			ALTER TABLE scans
			ADD COLUMN IF NOT EXISTS helm_scan_run_id UUID REFERENCES helm_scan_runs(id) ON DELETE SET NULL
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 25 (add scans.helm_scan_run_id): %w", err)
		}

		if _, err := db.NewRaw(`
			CREATE INDEX IF NOT EXISTS idx_scans_helm_scan_run_id ON scans (helm_scan_run_id, created_at DESC)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 25 (create idx_scans_helm_scan_run_id): %w", err)
		}

		if _, err := db.NewRaw(`
			CREATE INDEX IF NOT EXISTS idx_helm_scan_runs_user_created_at ON helm_scan_runs (user_id, created_at DESC)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 25 (create idx_helm_scan_runs_user_created_at): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw("DROP INDEX IF EXISTS idx_scans_helm_scan_run_id").Exec(ctx)          //nolint:errcheck
		db.NewRaw("DROP INDEX IF EXISTS idx_helm_scan_runs_user_created_at").Exec(ctx)  //nolint:errcheck
		db.NewRaw("ALTER TABLE scans DROP COLUMN IF EXISTS helm_scan_run_id").Exec(ctx) //nolint:errcheck
		db.NewRaw("DROP TABLE IF EXISTS helm_scan_runs").Exec(ctx)                      //nolint:errcheck
		return nil
	})
}
