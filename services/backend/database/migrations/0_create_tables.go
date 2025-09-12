package migrations

import (
	"context"
	"fmt"

	"justwms/pkg/models"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		return createSchema(ctx, db)
	}, func(ctx context.Context, db *bun.DB) error {
		return dropSchema(ctx, db)
	})
}

func createSchema(ctx context.Context, db *bun.DB) error {
	models := []interface{}{
		(*models.Tokens)(nil),
		(*models.Users)(nil),
		(*models.Audit)(nil),
		(*models.Kostenstellen)(nil),
		(*models.Artikel)(nil),
		(*models.Geraete)(nil),
	}

	for _, model := range models {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		if err != nil {
			return fmt.Errorf("failed to create table: %v", err)
		}
	}

	return nil
}

func dropSchema(ctx context.Context, db *bun.DB) error {
	models := []interface{}{
		(*models.Tokens)(nil),
		(*models.Users)(nil),
		(*models.Audit)(nil),
		(*models.Kostenstellen)(nil),
		(*models.Artikel)(nil),
		(*models.Geraete)(nil),
	}

	for _, model := range models {
		_, err := db.NewDropTable().Model(model).IfExists().Cascade().Exec(ctx)
		if err != nil {
			return fmt.Errorf("failed to drop table: %v", err)
		}
	}

	return nil
}
