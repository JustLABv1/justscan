package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		watchlistTimezoneExists, err := columnExists(ctx, db, "watchlist_items", "timezone")
		if err != nil {
			return fmt.Errorf("migration 35 (check watchlist_items.timezone): %w", err)
		}
		if !watchlistTimezoneExists {
			if _, err := db.NewRaw(`ALTER TABLE watchlist_items ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'`).Exec(ctx); err != nil {
				return fmt.Errorf("migration 35 (add watchlist timezone): %w", err)
			}
		}

		orgIDsExists, err := columnExists(ctx, db, "notification_channels", "org_ids")
		if err != nil {
			return fmt.Errorf("migration 35 (check notification_channels.org_ids): %w", err)
		}
		if !orgIDsExists {
			if _, err := db.NewRaw(`ALTER TABLE notification_channels ADD COLUMN org_ids JSONB NOT NULL DEFAULT '[]'::jsonb`).Exec(ctx); err != nil {
				return fmt.Errorf("migration 35 (add notification org_ids): %w", err)
			}
		}

		imagePatternsExists, err := columnExists(ctx, db, "notification_channels", "image_patterns")
		if err != nil {
			return fmt.Errorf("migration 35 (check notification_channels.image_patterns): %w", err)
		}
		if !imagePatternsExists {
			if _, err := db.NewRaw(`ALTER TABLE notification_channels ADD COLUMN image_patterns JSONB NOT NULL DEFAULT '[]'::jsonb`).Exec(ctx); err != nil {
				return fmt.Errorf("migration 35 (add notification image_patterns): %w", err)
			}
		}

		minSeverityExists, err := columnExists(ctx, db, "notification_channels", "min_severity")
		if err != nil {
			return fmt.Errorf("migration 35 (check notification_channels.min_severity): %w", err)
		}
		if !minSeverityExists {
			if _, err := db.NewRaw(`ALTER TABLE notification_channels ADD COLUMN min_severity TEXT NOT NULL DEFAULT ''`).Exec(ctx); err != nil {
				return fmt.Errorf("migration 35 (add notification min_severity): %w", err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`ALTER TABLE watchlist_items DROP COLUMN IF EXISTS timezone`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 35 rollback (drop watchlist timezone): %w", err)
		}
		if _, err := db.NewRaw(`ALTER TABLE notification_channels DROP COLUMN IF EXISTS org_ids`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 35 rollback (drop notification org_ids): %w", err)
		}
		if _, err := db.NewRaw(`ALTER TABLE notification_channels DROP COLUMN IF EXISTS image_patterns`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 35 rollback (drop notification image_patterns): %w", err)
		}
		if _, err := db.NewRaw(`ALTER TABLE notification_channels DROP COLUMN IF EXISTS min_severity`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 35 rollback (drop notification min_severity): %w", err)
		}
		return nil
	})
}
