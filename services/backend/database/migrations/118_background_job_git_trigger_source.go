package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Migration 118 tags existing Process Center mirrors of Git repository scans
// with trigger_source, like watchlist scans already are, so automated runs can
// be told apart from scans a person started.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			UPDATE background_jobs
			SET metadata = metadata || '{"trigger_source": "git_repository"}'::jsonb
			WHERE type = 'scan'
			  AND metadata->>'trigger_source' IS NULL
			  AND metadata->>'scan_id' IN (
				SELECT id::text FROM scans
				WHERE git_repository_run_id IS NOT NULL OR scan_source = 'git_repository'
			  )
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 118 background job git trigger source: %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			UPDATE background_jobs
			SET metadata = metadata - 'trigger_source'
			WHERE type = 'scan' AND metadata->>'trigger_source' = 'git_repository'
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 118 background job git trigger source rollback: %w", err)
		}
		return nil
	})
}
