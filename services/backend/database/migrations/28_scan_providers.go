package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if err := addScanProviderColumns(ctx, db); err != nil {
			return err
		}
		return addRegistryProviderColumns(ctx, db)
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`DROP INDEX IF EXISTS idx_scans_registry_id`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 28 rollback (drop idx_scans_registry_id): %w", err)
		}
		if _, err := db.NewRaw(`DROP INDEX IF EXISTS idx_scans_external_scan_id`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 28 rollback (drop idx_scans_external_scan_id): %w", err)
		}

		columns := []string{"scan_provider", "external_scan_id", "external_status", "registry_id"}
		for _, column := range columns {
			exists, err := columnExists(ctx, db, "scans", column)
			if err != nil {
				return fmt.Errorf("migration 28 rollback (check scans.%s): %w", column, err)
			}
			if exists {
				if _, err := db.NewRaw(fmt.Sprintf(`ALTER TABLE scans DROP COLUMN %s`, column)).Exec(ctx); err != nil {
					return fmt.Errorf("migration 28 rollback (drop scans.%s): %w", column, err)
				}
			}
		}

		exists, err := columnExists(ctx, db, "registries", "scan_provider")
		if err != nil {
			return fmt.Errorf("migration 28 rollback (check registries.scan_provider): %w", err)
		}
		if exists {
			if _, err := db.NewRaw(`ALTER TABLE registries DROP COLUMN scan_provider`).Exec(ctx); err != nil {
				return fmt.Errorf("migration 28 rollback (drop registries.scan_provider): %w", err)
			}
		}

		return nil
	})
}

func addScanProviderColumns(ctx context.Context, db *bun.DB) error {
	definitions := map[string]string{
		"scan_provider":    `ALTER TABLE scans ADD COLUMN scan_provider TEXT NOT NULL DEFAULT 'trivy'`,
		"external_scan_id": `ALTER TABLE scans ADD COLUMN external_scan_id TEXT NOT NULL DEFAULT ''`,
		"external_status":  `ALTER TABLE scans ADD COLUMN external_status TEXT NOT NULL DEFAULT ''`,
		"registry_id":      `ALTER TABLE scans ADD COLUMN registry_id UUID`,
	}

	for column, statement := range definitions {
		exists, err := columnExists(ctx, db, "scans", column)
		if err != nil {
			return fmt.Errorf("migration 28 (check scans.%s): %w", column, err)
		}
		if !exists {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 28 (add scans.%s): %w", column, err)
			}
		}
	}

	if _, err := db.NewRaw(`CREATE INDEX IF NOT EXISTS idx_scans_registry_id ON scans (registry_id)`).Exec(ctx); err != nil {
		return fmt.Errorf("migration 28 (create idx_scans_registry_id): %w", err)
	}
	if _, err := db.NewRaw(`CREATE INDEX IF NOT EXISTS idx_scans_external_scan_id ON scans (external_scan_id)`).Exec(ctx); err != nil {
		return fmt.Errorf("migration 28 (create idx_scans_external_scan_id): %w", err)
	}

	return nil
}

func addRegistryProviderColumns(ctx context.Context, db *bun.DB) error {
	exists, err := columnExists(ctx, db, "registries", "scan_provider")
	if err != nil {
		return fmt.Errorf("migration 28 (check registries.scan_provider): %w", err)
	}
	if !exists {
		if _, err := db.NewRaw(`ALTER TABLE registries ADD COLUMN scan_provider TEXT NOT NULL DEFAULT 'trivy'`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 28 (add registries.scan_provider): %w", err)
		}
	}
	return nil
}
