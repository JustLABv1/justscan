package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`ALTER TABLE scans ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'user'`,
			`ALTER TABLE scans ADD COLUMN IF NOT EXISTS owner_user_id UUID`,
			`ALTER TABLE scans ADD COLUMN IF NOT EXISTS owner_org_id UUID`,
			`ALTER TABLE registries ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'user'`,
			`ALTER TABLE registries ADD COLUMN IF NOT EXISTS owner_user_id UUID`,
			`ALTER TABLE registries ADD COLUMN IF NOT EXISTS owner_org_id UUID`,
			`ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'user'`,
			`ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS owner_user_id UUID`,
			`ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS owner_org_id UUID`,
			`ALTER TABLE suppressions ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'user'`,
			`ALTER TABLE suppressions ADD COLUMN IF NOT EXISTS owner_user_id UUID`,
			`ALTER TABLE suppressions ADD COLUMN IF NOT EXISTS owner_org_id UUID`,
			`ALTER TABLE tags ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'system'`,
			`ALTER TABLE tags ADD COLUMN IF NOT EXISTS owner_user_id UUID`,
			`ALTER TABLE tags ADD COLUMN IF NOT EXISTS owner_org_id UUID`,
			`CREATE INDEX IF NOT EXISTS idx_scans_owner_user_id ON scans (owner_user_id)`,
			`CREATE INDEX IF NOT EXISTS idx_scans_owner_org_id ON scans (owner_org_id)`,
			`CREATE INDEX IF NOT EXISTS idx_registries_owner_user_id ON registries (owner_user_id)`,
			`CREATE INDEX IF NOT EXISTS idx_registries_owner_org_id ON registries (owner_org_id)`,
			`CREATE INDEX IF NOT EXISTS idx_watchlist_owner_user_id ON watchlist_items (owner_user_id)`,
			`CREATE INDEX IF NOT EXISTS idx_watchlist_owner_org_id ON watchlist_items (owner_org_id)`,
			`CREATE INDEX IF NOT EXISTS idx_suppressions_owner_user_id ON suppressions (owner_user_id)`,
			`CREATE INDEX IF NOT EXISTS idx_suppressions_owner_org_id ON suppressions (owner_org_id)`,
			`CREATE INDEX IF NOT EXISTS idx_tags_owner_user_id ON tags (owner_user_id)`,
			`CREATE INDEX IF NOT EXISTS idx_tags_owner_org_id ON tags (owner_org_id)`,
			`CREATE TABLE IF NOT EXISTS org_registries (
				org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
				registry_id UUID NOT NULL REFERENCES registries(id) ON DELETE CASCADE,
				PRIMARY KEY (org_id, registry_id)
			)`,
			`CREATE TABLE IF NOT EXISTS org_watchlist_items (
				org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
				watchlist_item_id UUID NOT NULL REFERENCES watchlist_items(id) ON DELETE CASCADE,
				PRIMARY KEY (org_id, watchlist_item_id)
			)`,
			`CREATE TABLE IF NOT EXISTS org_tags (
				org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
				tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
				PRIMARY KEY (org_id, tag_id)
			)`,
			`CREATE TABLE IF NOT EXISTS org_suppressions (
				org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
				suppression_id UUID NOT NULL REFERENCES suppressions(id) ON DELETE CASCADE,
				PRIMARY KEY (org_id, suppression_id)
			)`,
			`DROP INDEX IF EXISTS idx_suppressions_digest_vuln`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_suppressions_owner_digest_vuln ON suppressions (
				COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
				COALESCE(owner_org_id, '00000000-0000-0000-0000-000000000000'::uuid),
				image_digest,
				vuln_id
			)`,
			`UPDATE scans
			 SET owner_user_id = COALESCE(owner_user_id, user_id),
			     owner_type = CASE WHEN owner_org_id IS NOT NULL THEN 'org' ELSE 'user' END
			 WHERE user_id IS NOT NULL`,
			`UPDATE registries
			 SET owner_user_id = COALESCE(owner_user_id, created_by_id),
			     owner_type = CASE WHEN owner_org_id IS NOT NULL THEN 'org' ELSE 'user' END
			 WHERE created_by_id IS NOT NULL`,
			`UPDATE watchlist_items
			 SET owner_user_id = COALESCE(owner_user_id, user_id),
			     owner_type = CASE WHEN owner_org_id IS NOT NULL THEN 'org' ELSE 'user' END
			 WHERE user_id IS NOT NULL`,
			`UPDATE suppressions
			 SET owner_user_id = COALESCE(owner_user_id, user_id),
			     owner_type = CASE WHEN owner_org_id IS NOT NULL THEN 'org' ELSE 'user' END
			 WHERE user_id IS NOT NULL`,
			`UPDATE tags
			 SET owner_type = CASE
			 	WHEN owner_user_id IS NOT NULL THEN 'user'
			 	WHEN owner_org_id IS NOT NULL THEN 'org'
			 	ELSE 'system'
			 END`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 40: %w", err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`DROP TABLE IF EXISTS org_suppressions`,
			`DROP TABLE IF EXISTS org_tags`,
			`DROP TABLE IF EXISTS org_watchlist_items`,
			`DROP TABLE IF EXISTS org_registries`,
			`DROP INDEX IF EXISTS idx_suppressions_owner_digest_vuln`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_suppressions_digest_vuln ON suppressions (image_digest, vuln_id)`,
			`ALTER TABLE tags DROP COLUMN IF EXISTS owner_org_id`,
			`ALTER TABLE tags DROP COLUMN IF EXISTS owner_user_id`,
			`ALTER TABLE tags DROP COLUMN IF EXISTS owner_type`,
			`ALTER TABLE suppressions DROP COLUMN IF EXISTS owner_org_id`,
			`ALTER TABLE suppressions DROP COLUMN IF EXISTS owner_user_id`,
			`ALTER TABLE suppressions DROP COLUMN IF EXISTS owner_type`,
			`ALTER TABLE watchlist_items DROP COLUMN IF EXISTS owner_org_id`,
			`ALTER TABLE watchlist_items DROP COLUMN IF EXISTS owner_user_id`,
			`ALTER TABLE watchlist_items DROP COLUMN IF EXISTS owner_type`,
			`ALTER TABLE registries DROP COLUMN IF EXISTS owner_org_id`,
			`ALTER TABLE registries DROP COLUMN IF EXISTS owner_user_id`,
			`ALTER TABLE registries DROP COLUMN IF EXISTS owner_type`,
			`ALTER TABLE scans DROP COLUMN IF EXISTS owner_org_id`,
			`ALTER TABLE scans DROP COLUMN IF EXISTS owner_user_id`,
			`ALTER TABLE scans DROP COLUMN IF EXISTS owner_type`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 40 rollback: %w", err)
			}
		}

		return nil
	})
}
