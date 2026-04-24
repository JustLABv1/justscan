package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`ALTER TABLE status_pages ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'user'`,
			`ALTER TABLE status_pages ADD COLUMN IF NOT EXISTS owner_org_id UUID`,
			`ALTER TABLE status_pages ALTER COLUMN owner_user_id DROP NOT NULL`,
			`CREATE INDEX IF NOT EXISTS idx_status_pages_owner_org_id ON status_pages (owner_org_id)`,
			`CREATE TABLE IF NOT EXISTS org_status_pages (
				org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
				status_page_id UUID NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
				PRIMARY KEY (org_id, status_page_id)
			)`,
			`UPDATE status_pages
			 SET owner_type = CASE WHEN owner_org_id IS NOT NULL THEN 'org' ELSE 'user' END,
			     owner_user_id = COALESCE(owner_user_id, NULL)
			 WHERE owner_type IS NOT NULL`,
			`ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_key`,
			`DROP INDEX IF EXISTS tags_name_key`,
			`DROP INDEX IF EXISTS idx_tags_name`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_owner_name ON tags (
				owner_type,
				COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
				COALESCE(owner_org_id, '00000000-0000-0000-0000-000000000000'::uuid),
				name
			)`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 41: %w", err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`DROP TABLE IF EXISTS org_status_pages`,
			`DROP INDEX IF EXISTS idx_status_pages_owner_org_id`,
			`DROP INDEX IF EXISTS idx_tags_owner_name`,
			`CREATE UNIQUE INDEX IF NOT EXISTS tags_name_key ON tags (name)`,
			`ALTER TABLE status_pages ALTER COLUMN owner_user_id SET NOT NULL`,
			`ALTER TABLE status_pages DROP COLUMN IF EXISTS owner_org_id`,
			`ALTER TABLE status_pages DROP COLUMN IF EXISTS owner_type`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 41 rollback: %w", err)
			}
		}

		return nil
	})
}
