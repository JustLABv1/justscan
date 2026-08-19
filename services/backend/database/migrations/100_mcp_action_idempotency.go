package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Migration 100 persists MCP action keys so retries are safe for scan-starting
// tools.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewRaw(`
CREATE TABLE IF NOT EXISTS mcp_action_idempotency (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    action TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    resource_id UUID NOT NULL,
    result_scan_id UUID,
    status TEXT NOT NULL DEFAULT 'running',
    error_message TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_mcp_action_idempotency_key UNIQUE (user_id, action, idempotency_key)
)`).Exec(ctx)
		if err != nil {
			return fmt.Errorf("migration 100 mcp action idempotency table: %w", err)
		}
		if _, err := db.NewRaw(`CREATE INDEX IF NOT EXISTS idx_mcp_action_idempotency_created_at ON mcp_action_idempotency(created_at)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 100 mcp action idempotency index: %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`DROP TABLE IF EXISTS mcp_action_idempotency`).Exec(ctx); err != nil {
			return fmt.Errorf("rollback migration 100 mcp action idempotency: %w", err)
		}
		return nil
	})
}
