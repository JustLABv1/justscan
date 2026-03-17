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
			(*models.Org)(nil),
			(*models.OrgPolicy)(nil),
			(*models.OrgScan)(nil),
			(*models.ComplianceResult)(nil),
		}
		for _, t := range tables {
			if _, err := db.NewCreateTable().Model(t).IfNotExists().Exec(ctx); err != nil {
				return fmt.Errorf("migration 9: %w", err)
			}
		}
		// composite PK on org_scans
		_, err := db.NewRaw(`DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_scans_pkey') THEN
                ALTER TABLE org_scans ADD PRIMARY KEY (org_id, scan_id);
            END IF;
        END $$`).Exec(ctx)
		return err
	}, func(ctx context.Context, db *bun.DB) error {
		for _, t := range []interface{}{
			(*models.ComplianceResult)(nil),
			(*models.OrgScan)(nil),
			(*models.OrgPolicy)(nil),
			(*models.Org)(nil),
		} {
			if _, err := db.NewDropTable().Model(t).IfExists().Cascade().Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}
