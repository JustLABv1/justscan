package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`CREATE TABLE IF NOT EXISTS vulnerability_intelligence_change_events (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				source TEXT NOT NULL,
				source_event_id TEXT NOT NULL,
				vuln_id TEXT NOT NULL,
				event_name TEXT NOT NULL,
				source_identifier TEXT NOT NULL DEFAULT '',
				observed_at TIMESTAMPTZ NOT NULL,
				before JSONB NOT NULL DEFAULT '{}',
				after JSONB NOT NULL DEFAULT '{}',
				details JSONB NOT NULL DEFAULT '[]',
				raw_payload JSONB NOT NULL DEFAULT '{}',
				processed_at TIMESTAMPTZ,
				processing_error TEXT NOT NULL DEFAULT '',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				UNIQUE (source, source_event_id)
			)`,
			`CREATE TABLE IF NOT EXISTS vulnerability_intelligence_sync_checkpoints (
				source TEXT PRIMARY KEY,
				cursor_at TIMESTAMPTZ NOT NULL,
				cursor_event_id TEXT NOT NULL DEFAULT '',
				last_attempt_at TIMESTAMPTZ,
				last_success_at TIMESTAMPTZ,
				next_retry_at TIMESTAMPTZ,
				consecutive_failures INTEGER NOT NULL DEFAULT 0,
				last_error TEXT NOT NULL DEFAULT '',
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`ALTER TABLE vulnerability_intelligence_evidence ADD COLUMN IF NOT EXISTS change_event_id UUID REFERENCES vulnerability_intelligence_change_events(id) ON DELETE SET NULL`,
			`ALTER TABLE vulnerability_postures ADD COLUMN IF NOT EXISTS change_event_id UUID REFERENCES vulnerability_intelligence_change_events(id) ON DELETE SET NULL`,
			`ALTER TABLE vulnerability_posture_events ADD COLUMN IF NOT EXISTS change_event_id UUID REFERENCES vulnerability_intelligence_change_events(id) ON DELETE SET NULL`,
			`ALTER TABLE vulnerability_posture_events ADD COLUMN IF NOT EXISTS previous_cve_state TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE vulnerability_posture_events ADD COLUMN IF NOT EXISTS cve_state TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE vulnerability_posture_events ADD COLUMN IF NOT EXISTS previous_severity TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE vulnerability_posture_events ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE vulnerability_posture_events ADD COLUMN IF NOT EXISTS previous_cvss_score DOUBLE PRECISION NOT NULL DEFAULT 0`,
			`ALTER TABLE vulnerability_posture_events ADD COLUMN IF NOT EXISTS cvss_score DOUBLE PRECISION NOT NULL DEFAULT 0`,
			`ALTER TABLE vulnerability_posture_events ADD COLUMN IF NOT EXISTS previous_cvss_vector TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE vulnerability_posture_events ADD COLUMN IF NOT EXISTS cvss_vector TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE vulnerability_posture_events ADD COLUMN IF NOT EXISTS previous_affected_ranges JSONB NOT NULL DEFAULT '[]'`,
			`ALTER TABLE vulnerability_posture_events ADD COLUMN IF NOT EXISTS affected_ranges JSONB NOT NULL DEFAULT '[]'`,
			`ALTER TABLE vulnerability_posture_events ADD COLUMN IF NOT EXISTS previous_fixed_versions JSONB NOT NULL DEFAULT '[]'`,
			`ALTER TABLE vulnerability_posture_events ADD COLUMN IF NOT EXISTS fixed_versions JSONB NOT NULL DEFAULT '[]'`,
			`CREATE INDEX IF NOT EXISTS idx_vulnerability_intelligence_change_events_vuln ON vulnerability_intelligence_change_events(vuln_id, observed_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_vulnerability_intelligence_change_events_pending ON vulnerability_intelligence_change_events(processed_at, observed_at)`,
			`CREATE INDEX IF NOT EXISTS idx_vulnerability_intelligence_evidence_change_event ON vulnerability_intelligence_evidence(change_event_id)`,
			`CREATE INDEX IF NOT EXISTS idx_vulnerability_posture_events_change_event ON vulnerability_posture_events(change_event_id)`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 92 CVE change history: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`ALTER TABLE vulnerability_posture_events DROP COLUMN IF EXISTS change_event_id`,
			`ALTER TABLE vulnerability_posture_events DROP COLUMN IF EXISTS previous_cve_state`,
			`ALTER TABLE vulnerability_posture_events DROP COLUMN IF EXISTS cve_state`,
			`ALTER TABLE vulnerability_posture_events DROP COLUMN IF EXISTS previous_severity`,
			`ALTER TABLE vulnerability_posture_events DROP COLUMN IF EXISTS severity`,
			`ALTER TABLE vulnerability_posture_events DROP COLUMN IF EXISTS previous_cvss_score`,
			`ALTER TABLE vulnerability_posture_events DROP COLUMN IF EXISTS cvss_score`,
			`ALTER TABLE vulnerability_posture_events DROP COLUMN IF EXISTS previous_cvss_vector`,
			`ALTER TABLE vulnerability_posture_events DROP COLUMN IF EXISTS cvss_vector`,
			`ALTER TABLE vulnerability_posture_events DROP COLUMN IF EXISTS previous_affected_ranges`,
			`ALTER TABLE vulnerability_posture_events DROP COLUMN IF EXISTS affected_ranges`,
			`ALTER TABLE vulnerability_posture_events DROP COLUMN IF EXISTS previous_fixed_versions`,
			`ALTER TABLE vulnerability_posture_events DROP COLUMN IF EXISTS fixed_versions`,
			`ALTER TABLE vulnerability_postures DROP COLUMN IF EXISTS change_event_id`,
			`ALTER TABLE vulnerability_intelligence_evidence DROP COLUMN IF EXISTS change_event_id`,
			`DROP TABLE IF EXISTS vulnerability_intelligence_sync_checkpoints`,
			`DROP TABLE IF EXISTS vulnerability_intelligence_change_events`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}
