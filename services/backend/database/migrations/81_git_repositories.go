package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`CREATE TABLE IF NOT EXISTS git_repositories (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, clone_url TEXT NOT NULL,
				ref TEXT NOT NULL DEFAULT 'HEAD', auth_type TEXT NOT NULL DEFAULT 'none', username TEXT NOT NULL DEFAULT '',
				encrypted_credential TEXT NOT NULL DEFAULT '', schedule TEXT NOT NULL DEFAULT '0 2 * * *', timezone TEXT NOT NULL DEFAULT 'UTC',
				enabled BOOLEAN NOT NULL DEFAULT FALSE, rescan_policy TEXT NOT NULL DEFAULT 'changed', tag_ids JSONB NOT NULL DEFAULT '[]',
				created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, owner_type TEXT NOT NULL DEFAULT 'user',
				owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE, owner_org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
				last_run_id UUID NULL, last_run_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)`,
			`CREATE TABLE IF NOT EXISTS git_repository_runs (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(), repository_id UUID NOT NULL REFERENCES git_repositories(id) ON DELETE CASCADE,
				trigger TEXT NOT NULL DEFAULT 'manual', requested_policy TEXT NOT NULL DEFAULT 'changed', ref TEXT NOT NULL DEFAULT '', commit_sha TEXT NOT NULL DEFAULT '',
				status TEXT NOT NULL DEFAULT 'queued', error_message TEXT NOT NULL DEFAULT '', target_count INT NOT NULL DEFAULT 0,
				image_count INT NOT NULL DEFAULT 0, scan_count INT NOT NULL DEFAULT 0, started_at TIMESTAMPTZ NULL, completed_at TIMESTAMPTZ NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)`,
			`CREATE TABLE IF NOT EXISTS git_repository_run_images (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(), run_id UUID NOT NULL REFERENCES git_repository_runs(id) ON DELETE CASCADE,
				full_ref TEXT NOT NULL, image_name TEXT NOT NULL, image_tag TEXT NOT NULL, locations JSONB NOT NULL DEFAULT '{}',
				state TEXT NOT NULL DEFAULT 'discovered', scan_id UUID NULL REFERENCES scans(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE(run_id, full_ref)
			)`,
			`ALTER TABLE scans ADD COLUMN IF NOT EXISTS git_repository_run_id UUID NULL REFERENCES git_repository_runs(id) ON DELETE SET NULL`,
			`CREATE INDEX IF NOT EXISTS idx_git_repositories_owner ON git_repositories(owner_user_id, owner_org_id)`,
			`CREATE INDEX IF NOT EXISTS idx_git_repository_runs_repository_created ON git_repository_runs(repository_id, created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_git_repository_run_images_run ON git_repository_run_images(run_id)`,
			`CREATE INDEX IF NOT EXISTS idx_scans_git_repository_run ON scans(git_repository_run_id, created_at DESC)`,
		}
		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 81 git repositories: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{`ALTER TABLE scans DROP COLUMN IF EXISTS git_repository_run_id`, `DROP TABLE IF EXISTS git_repository_run_images`, `DROP TABLE IF EXISTS git_repository_runs`, `DROP TABLE IF EXISTS git_repositories`} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}
