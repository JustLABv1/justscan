package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`ALTER TABLE pipeline_scan_requests ADD COLUMN IF NOT EXISTS initiator_token_id UUID NULL REFERENCES tokens(id) ON DELETE SET NULL`,
			`ALTER TABLE pipeline_scan_requests ADD COLUMN IF NOT EXISTS initiator_token_description TEXT NOT NULL DEFAULT ''`,
		}
		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 78 add pipeline scan initiators failed: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`ALTER TABLE pipeline_scan_requests DROP COLUMN IF EXISTS initiator_token_description`,
			`ALTER TABLE pipeline_scan_requests DROP COLUMN IF EXISTS initiator_token_id`,
		}
		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 78 remove pipeline scan initiators failed: %w", err)
			}
		}
		return nil
	})
}
