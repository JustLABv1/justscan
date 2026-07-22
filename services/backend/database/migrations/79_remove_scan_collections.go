package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`DROP TABLE IF EXISTS scan_collection_memberships CASCADE`,
			`DROP TABLE IF EXISTS scan_collections CASCADE`,
			`ALTER TABLE watchlist_items DROP COLUMN IF EXISTS collection_ids`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 79 remove scan collections: %w", err)
			}
		}
		return nil
	}, func(context.Context, *bun.DB) error {
		return fmt.Errorf("migration 79 cannot restore removed scan collections")
	})
}
