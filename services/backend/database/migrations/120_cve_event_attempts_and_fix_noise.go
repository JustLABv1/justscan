package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Migration 120 adds a retry counter to CVE change events so a single
// unprocessable event can be quarantined instead of blocking the sync
// checkpoint, resets events that failed on the former NUL-byte record key, and
// removes fix_available postures that only repeat the fixed version the scan
// already reported (they flagged findings as "changed" without new information).
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			ALTER TABLE vulnerability_intelligence_change_events
			ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 120 add change event attempts: %w", err)
		}
		if _, err := db.NewRaw(`
			UPDATE vulnerability_intelligence_change_events
			SET processing_error = '', updated_at = now()
			WHERE processed_at IS NULL
			  AND processing_error LIKE '%store intelligence feed records%syntax error%'
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 120 reset NUL-key failures: %w", err)
		}
		if _, err := db.NewRaw(`
			DELETE FROM vulnerability_postures AS p
			USING vulnerabilities AS v
			WHERE p.finding_id = v.id
			  AND p.state = 'fix_available'
			  AND btrim(v.fixed_version) <> ''
			  AND jsonb_typeof(p.fixed_versions) = 'array'
			  AND NOT EXISTS (
				SELECT 1
				FROM jsonb_array_elements_text(p.fixed_versions) AS fv(version)
				WHERE ltrim(lower(btrim(fv.version)), 'v') <> ALL (
					SELECT ltrim(lower(btrim(known)), 'v')
					FROM unnest(string_to_array(v.fixed_version, ',')) AS known
				)
			  )
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 120 clear repeated fix_available postures: %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			ALTER TABLE vulnerability_intelligence_change_events DROP COLUMN IF EXISTS attempts
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 120 rollback: %w", err)
		}
		return nil
	})
}
