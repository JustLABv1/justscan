package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Migration 110 stores Process Center removals per user. Deleting a job row
// would remove shared organization history and operational diagnostics for
// everyone, so dismissals are intentionally user-specific instead.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`CREATE TABLE IF NOT EXISTS background_job_dismissals (
				job_id UUID NOT NULL REFERENCES background_jobs(id) ON DELETE CASCADE,
				user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				PRIMARY KEY (job_id, user_id)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_background_job_dismissals_user_job ON background_job_dismissals (user_id, job_id)`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 110 background job dismissals: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`DROP INDEX IF EXISTS idx_background_job_dismissals_user_job`,
			`DROP TABLE IF EXISTS background_job_dismissals`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 110 background job dismissals rollback: %w", err)
			}
		}
		return nil
	})
}
