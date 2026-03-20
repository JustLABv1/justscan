package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			ALTER TABLE scans
			ADD COLUMN IF NOT EXISTS trivy_vuln_db_updated_at TIMESTAMPTZ,
			ADD COLUMN IF NOT EXISTS trivy_vuln_db_downloaded_at TIMESTAMPTZ,
			ADD COLUMN IF NOT EXISTS trivy_java_db_updated_at TIMESTAMPTZ,
			ADD COLUMN IF NOT EXISTS trivy_java_db_downloaded_at TIMESTAMPTZ
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 20 (trivy db metadata): %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw(`
			ALTER TABLE scans
			DROP COLUMN IF EXISTS trivy_vuln_db_updated_at,
			DROP COLUMN IF EXISTS trivy_vuln_db_downloaded_at,
			DROP COLUMN IF EXISTS trivy_java_db_updated_at,
			DROP COLUMN IF EXISTS trivy_java_db_downloaded_at
		`).Exec(ctx) //nolint:errcheck
		return nil
	})
}
