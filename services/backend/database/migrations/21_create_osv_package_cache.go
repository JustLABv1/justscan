package migrations

import (
	"context"
	"fmt"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewCreateTable().Model((*models.OSVPackageCache)(nil)).IfNotExists().Exec(ctx)
		if err != nil {
			return fmt.Errorf("migration 21 (create osv_package_cache): %w", err)
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewDropTable().Model((*models.OSVPackageCache)(nil)).IfExists().Cascade().Exec(ctx)
		if err != nil {
			return fmt.Errorf("migration 21 (drop osv_package_cache): %w", err)
		}
		return nil
	})
}
