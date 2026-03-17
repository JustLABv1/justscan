package migrations

import (
	"context"
	"fmt"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		return createTagsTables(ctx, db)
	}, func(ctx context.Context, db *bun.DB) error {
		return dropTagsTables(ctx, db)
	})
}

func createTagsTables(ctx context.Context, db *bun.DB) error {
	tables := []interface{}{
		(*models.Tag)(nil),
		(*models.ScanTag)(nil),
	}

	for _, model := range tables {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		if err != nil {
			return fmt.Errorf("failed to create tags table: %v", err)
		}
	}

	// Composite PK on scan_tags
	_, err := db.NewRaw("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scan_tags_pkey') THEN ALTER TABLE scan_tags ADD PRIMARY KEY (scan_id, tag_id); END IF; END $$").Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to add composite key to scan_tags: %v", err)
	}

	return nil
}

func dropTagsTables(ctx context.Context, db *bun.DB) error {
	tables := []interface{}{
		(*models.ScanTag)(nil),
		(*models.Tag)(nil),
	}

	for _, model := range tables {
		_, err := db.NewDropTable().Model(model).IfExists().Cascade().Exec(ctx)
		if err != nil {
			return fmt.Errorf("failed to drop tags table: %v", err)
		}
	}

	return nil
}
