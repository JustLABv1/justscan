package migrations

import (
	"context"
	"fmt"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewCreateTable().Model((*models.XraySuppression)(nil)).IfNotExists().Exec(ctx); err != nil {
			return fmt.Errorf("migration 38 (create xray_suppressions table): %w", err)
		}

		if _, err := db.NewRaw("CREATE INDEX IF NOT EXISTS idx_xray_suppressions_scan_id ON xray_suppressions (scan_id)").Exec(ctx); err != nil {
			return fmt.Errorf("migration 38 (index scan_id): %w", err)
		}

		if _, err := db.NewRaw("CREATE INDEX IF NOT EXISTS idx_xray_suppressions_digest_vuln ON xray_suppressions (image_digest, vuln_id)").Exec(ctx); err != nil {
			return fmt.Errorf("migration 38 (index image_digest,vuln_id): %w", err)
		}

		if _, err := db.NewRaw("CREATE UNIQUE INDEX IF NOT EXISTS idx_xray_suppressions_scan_vuln_rule ON xray_suppressions (scan_id, vuln_id, rule_id)").Exec(ctx); err != nil {
			return fmt.Errorf("migration 38 (unique scan_id,vuln_id,rule_id): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewDropTable().Model((*models.XraySuppression)(nil)).IfExists().Cascade().Exec(ctx); err != nil {
			return fmt.Errorf("migration 38 rollback (drop xray_suppressions table): %w", err)
		}
		return nil
	})
}
