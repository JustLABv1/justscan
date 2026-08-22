package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Migration 106 adds the durable completion key to archive upload sessions
// created before resumable completion became retry-safe.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`ALTER TABLE archive_upload_sessions ADD COLUMN IF NOT EXISTS scan_id UUID NULL REFERENCES scans(id) ON DELETE SET NULL`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_upload_sessions_scan_id ON archive_upload_sessions(scan_id) WHERE scan_id IS NOT NULL`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 106 archive upload scan id: %w", err)
			}
		}
		return nil
	}, func(context.Context, *bun.DB) error {
		// Migration 80 includes this column for fresh installs, so dropping it
		// during a rollback would leave a database marked through 80 with a schema
		// that no longer matches migration 80. It may also contain durable scan
		// completion keys; leave the repair intact rather than risking data loss.
		return nil
	})
}
