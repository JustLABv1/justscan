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
			ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 37 (add scans.last_progress_at): %w", err)
		}

		if _, err := db.NewRaw(`
			UPDATE scans
			SET last_progress_at = COALESCE(last_progress_at, completed_at, started_at, created_at, now())
			WHERE last_progress_at IS NULL
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 37 (backfill scans.last_progress_at): %w", err)
		}

		if _, err := db.NewRaw(`
			ALTER TABLE scans
			ALTER COLUMN last_progress_at SET DEFAULT now()
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 37 (default scans.last_progress_at): %w", err)
		}

		if _, err := db.NewRaw(`
			ALTER TABLE scans
			ALTER COLUMN last_progress_at SET NOT NULL
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 37 (not null scans.last_progress_at): %w", err)
		}

		if _, err := db.NewRaw(`
			CREATE INDEX IF NOT EXISTS idx_scans_status_last_progress_at
			ON scans(status, last_progress_at)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 37 (index scans.last_progress_at): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`DROP INDEX IF EXISTS idx_scans_status_last_progress_at`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 37 rollback (drop scans.last_progress_at index): %w", err)
		}
		if _, err := db.NewRaw(`ALTER TABLE scans DROP COLUMN IF EXISTS last_progress_at`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 37 rollback (drop scans.last_progress_at): %w", err)
		}
		return nil
	})
}
