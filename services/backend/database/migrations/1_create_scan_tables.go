package migrations

import (
	"context"
	"fmt"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		return createScanTables(ctx, db)
	}, func(ctx context.Context, db *bun.DB) error {
		return dropScanTables(ctx, db)
	})
}

func createScanTables(ctx context.Context, db *bun.DB) error {
	tables := []interface{}{
		(*models.Scan)(nil),
		(*models.Vulnerability)(nil),
		(*models.Comment)(nil),
	}

	for _, model := range tables {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		if err != nil {
			return fmt.Errorf("failed to create table: %v", err)
		}
	}

	// Index for fast scan lookups
	_, err := db.NewRaw("CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans (user_id)").Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to create index: %v", err)
	}
	_, err = db.NewRaw("CREATE INDEX IF NOT EXISTS idx_scans_status ON scans (status)").Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to create index: %v", err)
	}
	_, err = db.NewRaw("CREATE INDEX IF NOT EXISTS idx_vulnerabilities_scan_id ON vulnerabilities (scan_id)").Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to create index: %v", err)
	}
	_, err = db.NewRaw("CREATE INDEX IF NOT EXISTS idx_vulnerabilities_severity ON vulnerabilities (severity)").Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to create index: %v", err)
	}
	_, err = db.NewRaw("CREATE INDEX IF NOT EXISTS idx_comments_vulnerability_id ON comments (vulnerability_id)").Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to create index: %v", err)
	}

	return nil
}

func dropScanTables(ctx context.Context, db *bun.DB) error {
	tables := []interface{}{
		(*models.Comment)(nil),
		(*models.Vulnerability)(nil),
		(*models.Scan)(nil),
	}

	for _, model := range tables {
		_, err := db.NewDropTable().Model(model).IfExists().Cascade().Exec(ctx)
		if err != nil {
			return fmt.Errorf("failed to drop table: %v", err)
		}
	}

	return nil
}
