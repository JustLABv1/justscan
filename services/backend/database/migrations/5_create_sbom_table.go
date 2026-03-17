package migrations

import (
	"context"
	"fmt"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		return createSBOMTable(ctx, db)
	}, func(ctx context.Context, db *bun.DB) error {
		return dropSBOMTable(ctx, db)
	})
}

func createSBOMTable(ctx context.Context, db *bun.DB) error {
	_, err := db.NewCreateTable().Model((*models.SBOMComponent)(nil)).IfNotExists().Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to create sbom_components table: %v", err)
	}

	_, err = db.NewRaw("CREATE INDEX IF NOT EXISTS idx_sbom_scan_id ON sbom_components (scan_id)").Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to create index on sbom_components: %v", err)
	}

	return nil
}

func dropSBOMTable(ctx context.Context, db *bun.DB) error {
	_, err := db.NewDropTable().Model((*models.SBOMComponent)(nil)).IfExists().Cascade().Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to drop sbom_components table: %v", err)
	}
	return nil
}
