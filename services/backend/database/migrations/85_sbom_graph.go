package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`CREATE TABLE IF NOT EXISTS sbom_documents (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(), scan_id UUID NOT NULL UNIQUE REFERENCES scans(id) ON DELETE CASCADE,
				source TEXT NOT NULL DEFAULT 'legacy', status TEXT NOT NULL DEFAULT 'available', format TEXT NOT NULL DEFAULT 'cyclonedx-json',
				spec_version TEXT NOT NULL DEFAULT '', root_ref TEXT NOT NULL DEFAULT '', component_count INT NOT NULL DEFAULT 0,
				dependency_count INT NOT NULL DEFAULT 0, graph_complete BOOLEAN NOT NULL DEFAULT FALSE, warnings JSONB NOT NULL DEFAULT '[]',
				diagnostic TEXT NOT NULL DEFAULT '', raw_document JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)`,
			`ALTER TABLE sbom_components ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES sbom_documents(id) ON DELETE CASCADE`,
			`ALTER TABLE sbom_components ADD COLUMN IF NOT EXISTS bom_ref TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE sbom_components ADD COLUMN IF NOT EXISTS group_name TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE sbom_components ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE sbom_components ADD COLUMN IF NOT EXISTS ecosystem TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE sbom_components ADD COLUMN IF NOT EXISTS is_root BOOLEAN NOT NULL DEFAULT FALSE`,
			`ALTER TABLE sbom_components ADD COLUMN IF NOT EXISTS dependency_depth INT`,
			`ALTER TABLE sbom_components ADD COLUMN IF NOT EXISTS licenses JSONB NOT NULL DEFAULT '[]'`,
			`ALTER TABLE sbom_components ADD COLUMN IF NOT EXISTS hashes JSONB NOT NULL DEFAULT '[]'`,
			`ALTER TABLE sbom_components ADD COLUMN IF NOT EXISTS properties JSONB NOT NULL DEFAULT '[]'`,
			`CREATE TABLE IF NOT EXISTS sbom_dependencies (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(), document_id UUID NOT NULL REFERENCES sbom_documents(id) ON DELETE CASCADE,
				from_component_id UUID NOT NULL REFERENCES sbom_components(id) ON DELETE CASCADE, to_component_id UUID NOT NULL REFERENCES sbom_components(id) ON DELETE CASCADE,
				UNIQUE(document_id, from_component_id, to_component_id)
			)`,
			`CREATE TABLE IF NOT EXISTS vulnerability_component_links (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(), vulnerability_id UUID NOT NULL REFERENCES vulnerabilities(id) ON DELETE CASCADE,
				component_id UUID NOT NULL REFERENCES sbom_components(id) ON DELETE CASCADE, match_method TEXT NOT NULL, confidence TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(vulnerability_id, component_id)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_sbom_components_document_ref ON sbom_components(document_id, bom_ref)`,
			`CREATE INDEX IF NOT EXISTS idx_sbom_dependencies_document_from ON sbom_dependencies(document_id, from_component_id)`,
			`CREATE INDEX IF NOT EXISTS idx_sbom_dependencies_document_to ON sbom_dependencies(document_id, to_component_id)`,
			`CREATE INDEX IF NOT EXISTS idx_vulnerability_component_links_vulnerability ON vulnerability_component_links(vulnerability_id)`,
		}
		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 85 SBOM graph: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		for _, statement := range []string{`DROP TABLE IF EXISTS vulnerability_component_links`, `DROP TABLE IF EXISTS sbom_dependencies`, `DROP TABLE IF EXISTS sbom_documents`} {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}
