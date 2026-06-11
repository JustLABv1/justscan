package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`CREATE TABLE IF NOT EXISTS pipeline_scan_requests (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				scan_id UUID NOT NULL UNIQUE REFERENCES scans(id) ON DELETE CASCADE,
				org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
				source TEXT NOT NULL DEFAULT 'generic',
				external_ref TEXT NOT NULL DEFAULT '',
				callback_url TEXT NOT NULL DEFAULT '',
				encrypted_callback_secret TEXT NOT NULL DEFAULT '',
				verdict_config JSONB NOT NULL DEFAULT '{}'::jsonb,
				callback_event TEXT NOT NULL DEFAULT '',
				delivery_status TEXT NOT NULL DEFAULT 'awaiting_terminal',
				delivery_attempt_count INT NOT NULL DEFAULT 0,
				last_delivery_error TEXT NOT NULL DEFAULT '',
				last_attempt_at TIMESTAMPTZ NULL,
				delivered_at TIMESTAMPTZ NULL,
				next_attempt_at TIMESTAMPTZ NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE INDEX IF NOT EXISTS idx_pipeline_scan_requests_org_id ON pipeline_scan_requests (org_id)`,
			`CREATE INDEX IF NOT EXISTS idx_pipeline_scan_requests_delivery_status ON pipeline_scan_requests (delivery_status, next_attempt_at)`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 73 pipeline scan requests failed: %w", err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`DROP INDEX IF EXISTS idx_pipeline_scan_requests_delivery_status`,
			`DROP INDEX IF EXISTS idx_pipeline_scan_requests_org_id`,
			`DROP TABLE IF EXISTS pipeline_scan_requests`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 73 pipeline scan requests rollback failed: %w", err)
			}
		}

		return nil
	})
}
