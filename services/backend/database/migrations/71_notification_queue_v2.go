package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'system'`,
			`ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS scope_ref TEXT NOT NULL DEFAULT ''`,
			`CREATE INDEX IF NOT EXISTS idx_notification_channels_scope ON notification_channels (scope_type, scope_ref)`,
			`CREATE TABLE IF NOT EXISTS notification_rules (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				name TEXT NOT NULL,
				scope_type TEXT NOT NULL,
				scope_ref TEXT NOT NULL DEFAULT '',
				enabled BOOLEAN NOT NULL DEFAULT true,
				channel_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
				event_types JSONB NOT NULL DEFAULT '[]'::jsonb,
				conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
				delivery_mode TEXT NOT NULL DEFAULT 'immediate',
				digest_window_minutes INT NOT NULL DEFAULT 0,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE INDEX IF NOT EXISTS idx_notification_rules_scope ON notification_rules (scope_type, scope_ref)`,
			`CREATE TABLE IF NOT EXISTS notification_events (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				event TEXT NOT NULL,
				scan_id UUID NULL,
				payload JSONB NOT NULL DEFAULT '{}'::jsonb,
				matched_at TIMESTAMPTZ NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE INDEX IF NOT EXISTS idx_notification_events_unmatched ON notification_events (matched_at, created_at)`,
			`CREATE INDEX IF NOT EXISTS idx_notification_events_scan_id ON notification_events (scan_id)`,
			`CREATE TABLE IF NOT EXISTS notification_queue_jobs (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				event_id UUID NULL REFERENCES notification_events(id) ON DELETE SET NULL,
				rule_id UUID NOT NULL REFERENCES notification_rules(id) ON DELETE CASCADE,
				channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
				digest_id UUID NULL,
				scope_type TEXT NOT NULL,
				scope_ref TEXT NOT NULL DEFAULT '',
				delivery_mode TEXT NOT NULL DEFAULT 'immediate',
				status TEXT NOT NULL DEFAULT 'pending',
				attempt_count INT NOT NULL DEFAULT 0,
				max_attempts INT NOT NULL DEFAULT 5,
				next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				lease_owner TEXT NOT NULL DEFAULT '',
				leased_until TIMESTAMPTZ NULL,
				idempotency_key TEXT NOT NULL,
				payload JSONB NOT NULL DEFAULT '{}'::jsonb,
				last_error TEXT NOT NULL DEFAULT '',
				last_attempt_at TIMESTAMPTZ NULL,
				delivered_at TIMESTAMPTZ NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_queue_jobs_idempotency_key ON notification_queue_jobs (idempotency_key)`,
			`CREATE INDEX IF NOT EXISTS idx_notification_queue_jobs_pending ON notification_queue_jobs (status, next_attempt_at)`,
			`CREATE TABLE IF NOT EXISTS notification_digests (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				rule_id UUID NOT NULL REFERENCES notification_rules(id) ON DELETE CASCADE,
				channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
				scope_type TEXT NOT NULL,
				scope_ref TEXT NOT NULL DEFAULT '',
				window_start TIMESTAMPTZ NOT NULL,
				window_end TIMESTAMPTZ NOT NULL,
				status TEXT NOT NULL DEFAULT 'open',
				event_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
				event_count INT NOT NULL DEFAULT 0,
				last_event_at TIMESTAMPTZ NULL,
				queue_job_id UUID NULL,
				delivered_at TIMESTAMPTZ NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_digests_window ON notification_digests (rule_id, channel_id, window_start, window_end)`,
			`CREATE INDEX IF NOT EXISTS idx_notification_digests_status ON notification_digests (status, window_end)`,
			`DO $$ BEGIN
				IF NOT EXISTS (
					SELECT 1 FROM pg_constraint
					WHERE conname = 'fk_notification_queue_digest'
						AND conrelid = 'notification_queue_jobs'::regclass
				) THEN
					ALTER TABLE notification_queue_jobs
						ADD CONSTRAINT fk_notification_queue_digest
						FOREIGN KEY (digest_id) REFERENCES notification_digests(id) ON DELETE SET NULL;
				END IF;
			END $$`,
			`DO $$ BEGIN
				IF NOT EXISTS (
					SELECT 1 FROM pg_constraint
					WHERE conname = 'fk_notification_digests_queue_job'
						AND conrelid = 'notification_digests'::regclass
				) THEN
					ALTER TABLE notification_digests
						ADD CONSTRAINT fk_notification_digests_queue_job
						FOREIGN KEY (queue_job_id) REFERENCES notification_queue_jobs(id) ON DELETE SET NULL;
				END IF;
			END $$`,
			`ALTER TABLE notification_delivery_logs ADD COLUMN IF NOT EXISTS rule_id UUID NULL`,
			`ALTER TABLE notification_delivery_logs ADD COLUMN IF NOT EXISTS event_id UUID NULL`,
			`ALTER TABLE notification_delivery_logs ADD COLUMN IF NOT EXISTS queue_job_id UUID NULL`,
			`ALTER TABLE notification_delivery_logs ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'system'`,
			`ALTER TABLE notification_delivery_logs ADD COLUMN IF NOT EXISTS scope_ref TEXT NOT NULL DEFAULT ''`,
			`CREATE INDEX IF NOT EXISTS idx_notification_delivery_logs_queue_job_id ON notification_delivery_logs (queue_job_id)`,
			`CREATE INDEX IF NOT EXISTS idx_notification_delivery_logs_event_id ON notification_delivery_logs (event_id)`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 71 notification queue v2 failed: %w", err)
			}
		}

		if _, err := db.NewRaw(`
			INSERT INTO notification_rules (
				name, scope_type, scope_ref, enabled, channel_ids, event_types, conditions, delivery_mode, digest_window_minutes, created_at, updated_at
			)
			SELECT
				name || ' Rule',
				COALESCE(NULLIF(scope_type, ''), 'system'),
				COALESCE(scope_ref, ''),
				enabled,
				jsonb_build_array(id::text),
				CASE
					WHEN events IS NULL OR jsonb_typeof(events) <> 'array' THEN '[]'::jsonb
					ELSE events
				END,
				jsonb_strip_nulls(jsonb_build_object(
					'op', 'all',
					'conditions', jsonb_build_array(
						CASE
							WHEN org_ids IS NOT NULL AND jsonb_array_length(org_ids) > 0 THEN jsonb_build_object('field', 'org_id', 'operator', 'in', 'value', org_ids)
							ELSE NULL
						END,
						CASE
							WHEN image_patterns IS NOT NULL AND jsonb_array_length(image_patterns) > 0 THEN jsonb_build_object('field', 'image_ref', 'operator', 'matches_any', 'value', image_patterns)
							ELSE NULL
						END,
						CASE
							WHEN COALESCE(min_severity, '') <> '' THEN jsonb_build_object('field', 'highest_severity', 'operator', 'gte_severity', 'value', min_severity)
							ELSE NULL
						END
					)
				)),
				'immediate',
				0,
				created_at,
				updated_at
			FROM notification_channels nc
			WHERE NOT EXISTS (
				SELECT 1
				FROM notification_rules nr
				WHERE nr.scope_type = COALESCE(NULLIF(nc.scope_type, ''), 'system')
					AND nr.scope_ref = COALESCE(nc.scope_ref, '')
					AND nr.channel_ids = jsonb_build_array(nc.id::text)
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 71 notification queue v2 backfill failed: %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`DROP TABLE IF EXISTS notification_digests`,
			`DROP TABLE IF EXISTS notification_queue_jobs`,
			`DROP TABLE IF EXISTS notification_events`,
			`DROP TABLE IF EXISTS notification_rules`,
			`ALTER TABLE notification_delivery_logs DROP COLUMN IF EXISTS scope_ref`,
			`ALTER TABLE notification_delivery_logs DROP COLUMN IF EXISTS scope_type`,
			`ALTER TABLE notification_delivery_logs DROP COLUMN IF EXISTS queue_job_id`,
			`ALTER TABLE notification_delivery_logs DROP COLUMN IF EXISTS event_id`,
			`ALTER TABLE notification_delivery_logs DROP COLUMN IF EXISTS rule_id`,
			`ALTER TABLE notification_channels DROP COLUMN IF EXISTS scope_ref`,
			`ALTER TABLE notification_channels DROP COLUMN IF EXISTS scope_type`,
		}
		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 71 notification queue v2 rollback failed: %w", err)
			}
		}
		return nil
	})
}
