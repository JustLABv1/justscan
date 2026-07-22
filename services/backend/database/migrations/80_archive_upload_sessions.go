package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`CREATE TABLE IF NOT EXISTS archive_upload_sessions (
				id UUID PRIMARY KEY,
				org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
				user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
				filename TEXT NOT NULL,
				image_name TEXT NOT NULL DEFAULT '',
				image_tag TEXT NOT NULL DEFAULT '',
				platform TEXT NOT NULL DEFAULT '',
				expected_size BIGINT NOT NULL DEFAULT 0,
				uploaded_size BIGINT NOT NULL DEFAULT 0,
				archive_path TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'active',
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				expires_at TIMESTAMPTZ NOT NULL,
				completed_at TIMESTAMPTZ NULL
			)`,
			`CREATE INDEX IF NOT EXISTS idx_archive_upload_sessions_org_status ON archive_upload_sessions(org_id, status)`,
			`CREATE INDEX IF NOT EXISTS idx_archive_upload_sessions_expires_at ON archive_upload_sessions(expires_at)`,
		}
		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 80 archive upload sessions: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewRaw(`DROP TABLE IF EXISTS archive_upload_sessions`).Exec(ctx)
		return err
	})
}
