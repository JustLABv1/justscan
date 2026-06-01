package migrations

import (
	"context"
	"fmt"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		tables := []interface{}{
			(*models.ScanCollection)(nil),
			(*models.ScanCollectionMembership)(nil),
		}

		for _, model := range tables {
			if _, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx); err != nil {
				return fmt.Errorf("migration 72 create table: %w", err)
			}
		}

		statements := []string{
			`ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS collection_ids jsonb NOT NULL DEFAULT '[]'::jsonb`,
			`CREATE INDEX IF NOT EXISTS idx_scan_collections_owner_user_id ON scan_collections (owner_user_id)`,
			`CREATE INDEX IF NOT EXISTS idx_scan_collections_owner_org_id ON scan_collections (owner_org_id)`,
			`CREATE INDEX IF NOT EXISTS idx_scan_collection_memberships_collection_id ON scan_collection_memberships (collection_id)`,
			`CREATE INDEX IF NOT EXISTS idx_scan_collection_memberships_scan_id ON scan_collection_memberships (scan_id)`,
			`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scan_collection_memberships_pkey') THEN ALTER TABLE scan_collection_memberships ADD PRIMARY KEY (scan_id, collection_id); END IF; END $$`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_collections_owner_name ON scan_collections (
				owner_type,
				COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
				COALESCE(owner_org_id, '00000000-0000-0000-0000-000000000000'::uuid),
				LOWER(name)
			)`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 72: %w", err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`DROP INDEX IF EXISTS idx_scan_collections_owner_name`,
			`DROP INDEX IF EXISTS idx_scan_collection_memberships_scan_id`,
			`DROP INDEX IF EXISTS idx_scan_collection_memberships_collection_id`,
			`DROP INDEX IF EXISTS idx_scan_collections_owner_org_id`,
			`DROP INDEX IF EXISTS idx_scan_collections_owner_user_id`,
			`ALTER TABLE watchlist_items DROP COLUMN IF EXISTS collection_ids`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 72 rollback: %w", err)
			}
		}

		tables := []interface{}{
			(*models.ScanCollectionMembership)(nil),
			(*models.ScanCollection)(nil),
		}

		for _, model := range tables {
			if _, err := db.NewDropTable().Model(model).IfExists().Cascade().Exec(ctx); err != nil {
				return fmt.Errorf("migration 72 drop table: %w", err)
			}
		}

		return nil
	})
}
