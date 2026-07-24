package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`ALTER TABLE git_repository_runs ADD COLUMN IF NOT EXISTS unresolved_count INT NOT NULL DEFAULT 0`,
			`CREATE TABLE IF NOT EXISTS git_repository_discovery_rules (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(), repository_id UUID NOT NULL REFERENCES git_repositories(id) ON DELETE CASCADE,
				path_pattern TEXT NOT NULL, resolution TEXT NOT NULL, config JSONB NOT NULL DEFAULT '{}', active BOOLEAN NOT NULL DEFAULT TRUE,
				created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE(repository_id, path_pattern)
			)`,
			`CREATE TABLE IF NOT EXISTS git_repository_run_candidates (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(), run_id UUID NOT NULL REFERENCES git_repository_runs(id) ON DELETE CASCADE,
				path TEXT NOT NULL, detected_type TEXT NOT NULL, confidence TEXT NOT NULL, evidence JSONB NOT NULL DEFAULT '{}',
				status TEXT NOT NULL DEFAULT 'unresolved', rule_id UUID NULL REFERENCES git_repository_discovery_rules(id) ON DELETE SET NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(run_id, path)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_git_repository_discovery_rules_repository ON git_repository_discovery_rules(repository_id, active)`,
			`CREATE INDEX IF NOT EXISTS idx_git_repository_run_candidates_run ON git_repository_run_candidates(run_id, status)`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 83 Git repository discovery review: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{`DROP TABLE IF EXISTS git_repository_run_candidates`, `DROP TABLE IF EXISTS git_repository_discovery_rules`, `ALTER TABLE git_repository_runs DROP COLUMN IF EXISTS unresolved_count`} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}
