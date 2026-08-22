package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Migration 104 repairs installations where the historical duplicate 101
// identifier marked only one of the two migrations.  IF NOT EXISTS keeps this
// safe when the MCP table was already created by the old migration.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewRaw(`
CREATE TABLE IF NOT EXISTS mcp_interactions (
    id UUID PRIMARY KEY,
    user_id TEXT,
    transport TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    action BOOLEAN NOT NULL DEFAULT FALSE,
    replayed BOOLEAN NOT NULL DEFAULT FALSE,
    resource_id UUID,
    error_code TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`).Exec(ctx)
		if err != nil {
			return fmt.Errorf("migration 104 mcp interactions table repair: %w", err)
		}
		for _, statement := range []string{
			`CREATE INDEX IF NOT EXISTS idx_mcp_interactions_created_at ON mcp_interactions(created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_mcp_interactions_tool_created_at ON mcp_interactions(tool_name, created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_mcp_interactions_user_created_at ON mcp_interactions(user_id, created_at DESC)`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 104 mcp interactions index repair: %w", err)
			}
		}
		return nil
	}, func(context.Context, *bun.DB) error {
		// The table may have been created by the legacy 101 migration before
		// this repair ran. Dropping it during rollback could destroy production
		// interaction history, and there is no safe way to distinguish ownership
		// of the pre-existing table. Leave the idempotently repaired schema intact.
		return nil
	})
}
