package migrations

import (
	"context"
	"fmt"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		return createSuppressionTable(ctx, db)
	}, func(ctx context.Context, db *bun.DB) error {
		return dropSuppressionTable(ctx, db)
	})
}

func createSuppressionTable(ctx context.Context, db *bun.DB) error {
	_, err := db.NewCreateTable().Model((*models.Suppression)(nil)).IfNotExists().Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to create suppressions table: %v", err)
	}

	// Unique constraint: one suppression per CVE per image digest
	_, err = db.NewRaw("CREATE UNIQUE INDEX IF NOT EXISTS idx_suppressions_digest_vuln ON suppressions (image_digest, vuln_id)").Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to create unique index on suppressions: %v", err)
	}

	_, err = db.NewRaw("CREATE INDEX IF NOT EXISTS idx_suppressions_image_digest ON suppressions (image_digest)").Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to create index on suppressions: %v", err)
	}

	return nil
}

func dropSuppressionTable(ctx context.Context, db *bun.DB) error {
	_, err := db.NewDropTable().Model((*models.Suppression)(nil)).IfExists().Cascade().Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to drop suppressions table: %v", err)
	}
	return nil
}
