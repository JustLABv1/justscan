package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		definitions := map[string]string{
			"xray_url":            `ALTER TABLE registries ADD COLUMN xray_url TEXT NOT NULL DEFAULT ''`,
			"xray_artifactory_id": `ALTER TABLE registries ADD COLUMN xray_artifactory_id TEXT NOT NULL DEFAULT 'default'`,
		}

		for column, statement := range definitions {
			exists, err := columnExists(ctx, db, "registries", column)
			if err != nil {
				return fmt.Errorf("migration 29 (check registries.%s): %w", column, err)
			}
			if !exists {
				if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
					return fmt.Errorf("migration 29 (add registries.%s): %w", column, err)
				}
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, column := range []string{"xray_url", "xray_artifactory_id"} {
			exists, err := columnExists(ctx, db, "registries", column)
			if err != nil {
				return fmt.Errorf("migration 29 rollback (check registries.%s): %w", column, err)
			}
			if exists {
				if _, err := db.NewRaw(fmt.Sprintf(`ALTER TABLE registries DROP COLUMN %s`, column)).Exec(ctx); err != nil {
					return fmt.Errorf("migration 29 rollback (drop registries.%s): %w", column, err)
				}
			}
		}
		return nil
	})
}
