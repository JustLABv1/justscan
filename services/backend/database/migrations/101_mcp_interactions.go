package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Migration 101 stores metadata-only MCP tool interaction events for admin
// analytics. Raw prompts, arguments, tokens, and outputs are never persisted.
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
			return fmt.Errorf("migration 101 mcp interactions table: %w", err)
		}
		for _, statement := range []string{
			`CREATE INDEX IF NOT EXISTS idx_mcp_interactions_created_at ON mcp_interactions(created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_mcp_interactions_tool_created_at ON mcp_interactions(tool_name, created_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_mcp_interactions_user_created_at ON mcp_interactions(user_id, created_at DESC)`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 101 mcp interactions index: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`DROP TABLE IF EXISTS mcp_interactions`).Exec(ctx); err != nil {
			return fmt.Errorf("rollback migration 101 mcp interactions: %w", err)
		}
		return nil
	})
}
