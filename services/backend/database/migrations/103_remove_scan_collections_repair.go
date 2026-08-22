package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Migration 103 repairs installations that were affected by the historical
// duplicate 79 migration identifier.  The old migration may already have
// removed some or all of this schema; every statement is therefore
// deliberately idempotent.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`DROP TABLE IF EXISTS scan_collection_memberships CASCADE`,
			`DROP TABLE IF EXISTS scan_collections CASCADE`,
			`ALTER TABLE watchlist_items DROP COLUMN IF EXISTS collection_ids`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 103 remove scan collections repair: %w", err)
			}
		}
		return nil
	}, func(context.Context, *bun.DB) error {
		return fmt.Errorf("migration 103 cannot restore removed scan collections")
	})
}
