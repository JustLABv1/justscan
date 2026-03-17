package migrations

import (
	"context"
	"fmt"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		return createVulnKBTable(ctx, db)
	}, func(ctx context.Context, db *bun.DB) error {
		return dropVulnKBTable(ctx, db)
	})
}

func createVulnKBTable(ctx context.Context, db *bun.DB) error {
	_, err := db.NewCreateTable().Model((*models.VulnKBEntry)(nil)).IfNotExists().Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to create vuln_kb table: %v", err)
	}
	return nil
}

func dropVulnKBTable(ctx context.Context, db *bun.DB) error {
	_, err := db.NewDropTable().Model((*models.VulnKBEntry)(nil)).IfExists().Cascade().Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to drop vuln_kb table: %v", err)
	}
	return nil
}
