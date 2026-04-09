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
			ADD COLUMN IF NOT EXISTS current_step TEXT NOT NULL DEFAULT 'queued'
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 32 (add scans.current_step): %w", err)
		}

		if _, err := db.NewRaw(`
			UPDATE scans
			SET current_step = CASE
				WHEN status = 'completed' THEN 'completed'
				WHEN status = 'failed' THEN 'failed'
				WHEN status = 'cancelled' THEN 'cancelled'
				WHEN scan_provider = 'artifactory_xray' AND external_status = 'warming_artifactory_cache' THEN 'warming_cache'
				WHEN scan_provider = 'artifactory_xray' AND external_status = 'indexing' THEN 'indexing_artifact'
				WHEN scan_provider = 'artifactory_xray' AND external_status = 'queued' THEN 'queued_in_xray'
				WHEN scan_provider = 'artifactory_xray' AND external_status = 'waiting_for_xray' THEN 'waiting_for_xray'
				WHEN scan_provider = 'artifactory_xray' AND external_status = 'importing' THEN 'importing_results'
				WHEN scan_provider = 'artifactory_xray' AND external_status = 'blocked_by_xray_policy' THEN 'failed'
				WHEN status = 'running' THEN 'scanning_image'
				ELSE 'queued'
			END
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 32 (backfill scans.current_step): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			ALTER TABLE scans
			DROP COLUMN IF EXISTS current_step
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 32 rollback (drop scans.current_step): %w", err)
		}
		return nil
	})
}
