package migrations

import (
	"context"
	"fmt"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		return createRegistriesTable(ctx, db)
	}, func(ctx context.Context, db *bun.DB) error {
		return dropRegistriesTable(ctx, db)
	})
}

func createRegistriesTable(ctx context.Context, db *bun.DB) error {
	_, err := db.NewCreateTable().Model((*models.Registry)(nil)).IfNotExists().Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to create registries table: %v", err)
	}
	return nil
}

func dropRegistriesTable(ctx context.Context, db *bun.DB) error {
	_, err := db.NewDropTable().Model((*models.Registry)(nil)).IfExists().Cascade().Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to drop registries table: %v", err)
	}
	return nil
}
