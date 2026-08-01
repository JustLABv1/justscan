package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`CREATE TABLE IF NOT EXISTS vulnerability_intelligence_sync_runs (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				source TEXT NOT NULL,
				trigger TEXT NOT NULL DEFAULT 'scheduler',
				status TEXT NOT NULL DEFAULT 'running',
				started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				completed_at TIMESTAMPTZ,
				error TEXT NOT NULL DEFAULT '',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE INDEX IF NOT EXISTS idx_vulnerability_intelligence_sync_runs_started ON vulnerability_intelligence_sync_runs(started_at DESC)`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 93 CVE sync runs: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewRaw(`DROP TABLE IF EXISTS vulnerability_intelligence_sync_runs`).Exec(ctx)
		return err
	})
}
