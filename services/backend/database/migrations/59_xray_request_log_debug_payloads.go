package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`ALTER TABLE xray_request_logs ADD COLUMN IF NOT EXISTS request_url text NOT NULL DEFAULT ''`,
			`ALTER TABLE xray_request_logs ADD COLUMN IF NOT EXISTS request_headers jsonb NOT NULL DEFAULT '{}'::jsonb`,
			`ALTER TABLE xray_request_logs ADD COLUMN IF NOT EXISTS request_body text NOT NULL DEFAULT ''`,
			`ALTER TABLE xray_request_logs ADD COLUMN IF NOT EXISTS response_headers jsonb NOT NULL DEFAULT '{}'::jsonb`,
			`ALTER TABLE xray_request_logs ADD COLUMN IF NOT EXISTS response_body text NOT NULL DEFAULT ''`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 59: %w", err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`ALTER TABLE xray_request_logs DROP COLUMN IF EXISTS response_body`,
			`ALTER TABLE xray_request_logs DROP COLUMN IF EXISTS response_headers`,
			`ALTER TABLE xray_request_logs DROP COLUMN IF EXISTS request_body`,
			`ALTER TABLE xray_request_logs DROP COLUMN IF EXISTS request_headers`,
			`ALTER TABLE xray_request_logs DROP COLUMN IF EXISTS request_url`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}
