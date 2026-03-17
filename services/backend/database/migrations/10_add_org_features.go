package migrations

import (
	"context"
	"fmt"
	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		// Add image_patterns to orgs
		if _, err := db.NewRaw(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS image_patterns jsonb NOT NULL DEFAULT '[]'`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 10: %w", err)
		}
		// Create compliance_history table
		if _, err := db.NewCreateTable().Model((*models.ComplianceHistory)(nil)).IfNotExists().Exec(ctx); err != nil {
			return fmt.Errorf("migration 10 history: %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw(`ALTER TABLE orgs DROP COLUMN IF EXISTS image_patterns`).Exec(ctx) //nolint:errcheck
		db.NewDropTable().Model((*models.ComplianceHistory)(nil)).IfExists().Exec(ctx) //nolint:errcheck
		return nil
	})
}
