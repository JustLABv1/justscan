package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Migration 108 adds the durable process center used by long-running,
// user-triggered work. Worker leases make queued work recoverable after a
// process restart, while the partial unique index prevents duplicate active
// work for the same logical target.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`CREATE TABLE IF NOT EXISTS background_jobs (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				scope_type TEXT NOT NULL DEFAULT 'user',
				scope_ref TEXT NOT NULL DEFAULT '',
				type TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'queued',
				title TEXT NOT NULL DEFAULT '',
				description TEXT NOT NULL DEFAULT '',
				progress_current INTEGER NOT NULL DEFAULT 0,
				progress_total INTEGER NOT NULL DEFAULT 0,
				phase TEXT NOT NULL DEFAULT '',
				error_message TEXT NOT NULL DEFAULT '',
				metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
				payload JSONB NOT NULL DEFAULT '{}'::jsonb,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				started_at TIMESTAMPTZ NULL,
				finished_at TIMESTAMPTZ NULL,
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				lease_owner TEXT NOT NULL DEFAULT '',
				lease_until TIMESTAMPTZ NULL,
				error_log TEXT NOT NULL DEFAULT '',
				dedupe_key TEXT NOT NULL DEFAULT ''
			)`,
			`CREATE INDEX IF NOT EXISTS idx_background_jobs_user_created_at ON background_jobs (user_id, created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_background_jobs_scope_created_at ON background_jobs (scope_type, scope_ref, created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_background_jobs_claimable ON background_jobs (status, lease_until, created_at)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_background_jobs_active_dedupe ON background_jobs (dedupe_key) WHERE dedupe_key <> '' AND status IN ('queued', 'running')`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 108 background jobs: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`DROP INDEX IF EXISTS idx_background_jobs_active_dedupe`,
			`DROP INDEX IF EXISTS idx_background_jobs_claimable`,
			`DROP INDEX IF EXISTS idx_background_jobs_scope_created_at`,
			`DROP INDEX IF EXISTS idx_background_jobs_user_created_at`,
			`DROP TABLE IF EXISTS background_jobs`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 108 background jobs rollback: %w", err)
			}
		}
		return nil
	})
}
