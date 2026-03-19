package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS scan_manual_findings (
				id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
				scan_id           uuid        NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
				vuln_id           text        NOT NULL DEFAULT '',
				severity          text        NOT NULL DEFAULT 'UNKNOWN',
				pkg_name          text        NOT NULL DEFAULT '',
				installed_version text        NOT NULL DEFAULT '',
				fixed_version     text        NOT NULL DEFAULT '',
				title             text        NOT NULL DEFAULT '',
				description       text        NOT NULL DEFAULT '',
				cvss_score        float       NOT NULL DEFAULT 0,
				justification     text        NOT NULL DEFAULT '',
				created_by        uuid        NOT NULL,
				created_at        timestamptz NOT NULL DEFAULT now(),
				updated_at        timestamptz NOT NULL DEFAULT now()
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 17 (scan_manual_findings): %w", err)
		}

		if _, err := db.NewRaw(`
			CREATE INDEX IF NOT EXISTS scan_manual_findings_scan_id_idx ON scan_manual_findings (scan_id)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 17 (scan_manual_findings index): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw("DROP TABLE IF EXISTS scan_manual_findings").Exec(ctx) //nolint:errcheck
		return nil
	})
}
