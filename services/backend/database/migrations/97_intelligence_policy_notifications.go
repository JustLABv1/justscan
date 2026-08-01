package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Migration 97 adds notification deduplication for intelligence-driven
// policy-impact events. It is additive and does not create an intelligence
// table or backfill existing data.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS dedupe_key TEXT`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_events_dedupe_key ON notification_events (dedupe_key) WHERE dedupe_key IS NOT NULL AND dedupe_key <> ''`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 97 intelligence policy notifications: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`DROP INDEX IF EXISTS idx_notification_events_dedupe_key`,
			`ALTER TABLE notification_events DROP COLUMN IF EXISTS dedupe_key`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}
