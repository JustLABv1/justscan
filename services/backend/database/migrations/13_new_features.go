package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		// Create auto_tag_rules table
		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS auto_tag_rules (
				id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
				pattern        text        NOT NULL,
				tag_id         uuid        NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
				created_by_id  uuid        NOT NULL,
				created_at     timestamptz NOT NULL DEFAULT now(),
				updated_at     timestamptz NOT NULL DEFAULT now()
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 13 (auto_tag_rules): %w", err)
		}

		// Add health columns to registries
		if _, err := db.NewRaw(`
			ALTER TABLE registries
				ADD COLUMN IF NOT EXISTS health_status       text        NOT NULL DEFAULT 'unknown',
				ADD COLUMN IF NOT EXISTS health_message      text        NOT NULL DEFAULT '',
				ADD COLUMN IF NOT EXISTS last_health_check_at timestamptz
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 13 (registry health columns): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw("DROP TABLE IF EXISTS auto_tag_rules").Exec(ctx) //nolint:errcheck
		db.NewRaw(`
			ALTER TABLE registries
				DROP COLUMN IF EXISTS health_status,
				DROP COLUMN IF EXISTS health_message,
				DROP COLUMN IF EXISTS last_health_check_at
		`).Exec(ctx) //nolint:errcheck
		return nil
	})
}
