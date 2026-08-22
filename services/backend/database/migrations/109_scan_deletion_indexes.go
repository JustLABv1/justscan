package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// Migration 109 adds the indexes required by scan deletion's explicit cleanup
// queries and by the child-side checks PostgreSQL performs while cascading
// deletes. Several of these relationships predate their indexes, so a group
// delete could scan a table once per deleted component or scan.
func init() {
	Migrations.MustRegister(addScanDeletionIndexes, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{
			`DROP INDEX IF EXISTS idx_vulnerability_component_links_component_id`,
			`DROP INDEX IF EXISTS idx_sbom_dependencies_to_component_id`,
			`DROP INDEX IF EXISTS idx_sbom_dependencies_from_component_id`,
			`DROP INDEX IF EXISTS idx_vulnerability_postures_scan_id`,
			`DROP INDEX IF EXISTS idx_git_repository_run_images_scan_id`,
			`DROP INDEX IF EXISTS idx_compliance_history_scan_id`,
			`DROP INDEX IF EXISTS idx_compliance_results_scan_id`,
			`DROP INDEX IF EXISTS idx_org_scans_scan_id`,
			`DROP INDEX IF EXISTS idx_comments_scan_id`,
		} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 109 scan deletion indexes rollback: %w", err)
			}
		}
		return nil
	})
}

type scanDeletionIndex struct {
	table     string
	column    string
	statement string
}

var scanDeletionIndexes = []scanDeletionIndex{
	{table: "comments", column: "scan_id", statement: `CREATE INDEX IF NOT EXISTS idx_comments_scan_id ON comments (scan_id)`},
	{table: "org_scans", column: "scan_id", statement: `CREATE INDEX IF NOT EXISTS idx_org_scans_scan_id ON org_scans (scan_id)`},
	{table: "compliance_results", column: "scan_id", statement: `CREATE INDEX IF NOT EXISTS idx_compliance_results_scan_id ON compliance_results (scan_id)`},
	{table: "compliance_history", column: "scan_id", statement: `CREATE INDEX IF NOT EXISTS idx_compliance_history_scan_id ON compliance_history (scan_id)`},
	{table: "git_repository_run_images", column: "scan_id", statement: `CREATE INDEX IF NOT EXISTS idx_git_repository_run_images_scan_id ON git_repository_run_images (scan_id)`},
	{table: "vulnerability_postures", column: "scan_id", statement: `CREATE INDEX IF NOT EXISTS idx_vulnerability_postures_scan_id ON vulnerability_postures (scan_id)`},
	{table: "sbom_dependencies", column: "from_component_id", statement: `CREATE INDEX IF NOT EXISTS idx_sbom_dependencies_from_component_id ON sbom_dependencies (from_component_id)`},
	{table: "sbom_dependencies", column: "to_component_id", statement: `CREATE INDEX IF NOT EXISTS idx_sbom_dependencies_to_component_id ON sbom_dependencies (to_component_id)`},
	{table: "vulnerability_component_links", column: "component_id", statement: `CREATE INDEX IF NOT EXISTS idx_vulnerability_component_links_component_id ON vulnerability_component_links (component_id)`},
}

func addScanDeletionIndexes(ctx context.Context, db *bun.DB) error {
	for _, index := range scanDeletionIndexes {
		exists, err := columnExists(ctx, db, index.table, index.column)
		if err != nil {
			return fmt.Errorf("migration 109 check %s.%s: %w", index.table, index.column, err)
		}
		if !exists {
			continue
		}
		if _, err := db.NewRaw(index.statement).Exec(ctx); err != nil {
			return fmt.Errorf("migration 109 scan deletion indexes: %w", err)
		}
	}
	return nil
}
