package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type SBOMComponent struct {
	bun.BaseModel `bun:"table:sbom_components"`

	ID         uuid.UUID    `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ScanID     uuid.UUID    `bun:"scan_id,type:uuid,notnull" json:"scan_id"`
	Name       string       `bun:"name,type:text,notnull" json:"name"`
	Version    string       `bun:"version,type:text,default:''" json:"version"`
	Type       string       `bun:"type,type:text,default:'library'" json:"type"`
	DocumentID *uuid.UUID   `bun:"document_id,type:uuid" json:"document_id,omitempty"`
	BOMRef     string       `bun:"bom_ref,type:text,default:''" json:"bom_ref,omitempty"`
	Group      string       `bun:"group_name,type:text,default:''" json:"group,omitempty"`
	Scope      string       `bun:"scope,type:text,default:''" json:"scope,omitempty"`
	Ecosystem  string       `bun:"ecosystem,type:text,default:''" json:"ecosystem,omitempty"`
	IsRoot     bool         `bun:"is_root,type:boolean,notnull,default:false" json:"is_root,omitempty"`
	Depth      *int         `bun:"dependency_depth,type:int" json:"dependency_depth,omitempty"`
	PackageURL string       `bun:"package_url,type:text,default:''" json:"package_url"`
	License    string       `bun:"license,type:text,default:''" json:"license"`
	Licenses   []string     `bun:"licenses,type:jsonb,notnull,default:'[]'" json:"licenses,omitempty"`
	Hashes     []JSONObject `bun:"hashes,type:jsonb,notnull,default:'[]'" json:"hashes,omitempty"`
	Properties []JSONObject `bun:"properties,type:jsonb,notnull,default:'[]'" json:"properties,omitempty"`
	Supplier   string       `bun:"supplier,type:text,default:''" json:"supplier"`
	CreatedAt  time.Time    `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`

	VulnerabilityCount int `bun:"-" json:"vulnerability_count,omitempty"`
}

// SBOMDocument retains the original CycloneDX evidence and the quality of the
// graph derived from it. A scan has at most one active document.
type SBOMDocument struct {
	bun.BaseModel `bun:"table:sbom_documents"`

	ID              uuid.UUID  `bun:",pk,type:uuid" json:"id"`
	ScanID          uuid.UUID  `bun:"scan_id,type:uuid,notnull,unique" json:"scan_id"`
	Source          string     `bun:"source,type:text,notnull,default:'legacy'" json:"source"`
	Status          string     `bun:"status,type:text,notnull,default:'available'" json:"status"`
	Format          string     `bun:"format,type:text,notnull,default:'cyclonedx-json'" json:"format"`
	SpecVersion     string     `bun:"spec_version,type:text,default:''" json:"spec_version,omitempty"`
	RootRef         string     `bun:"root_ref,type:text,default:''" json:"root_ref,omitempty"`
	ComponentCount  int        `bun:"component_count,type:int,notnull,default:0" json:"component_count"`
	DependencyCount int        `bun:"dependency_count,type:int,notnull,default:0" json:"dependency_count"`
	GraphComplete   bool       `bun:"graph_complete,type:boolean,notnull,default:false" json:"graph_complete"`
	Warnings        []string   `bun:"warnings,type:jsonb,notnull,default:'[]'" json:"warnings,omitempty"`
	Diagnostic      string     `bun:"diagnostic,type:text,default:''" json:"diagnostic,omitempty"`
	RawDocument     JSONObject `bun:"raw_document,type:jsonb,notnull,default:'{}'" json:"-"`
	CreatedAt       time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt       time.Time  `bun:"updated_at,type:timestamptz,default:now()" json:"updated_at"`
}

type SBOMDependency struct {
	bun.BaseModel `bun:"table:sbom_dependencies"`

	ID              uuid.UUID `bun:",pk,type:uuid" json:"id"`
	DocumentID      uuid.UUID `bun:"document_id,type:uuid,notnull" json:"document_id"`
	FromComponentID uuid.UUID `bun:"from_component_id,type:uuid,notnull" json:"from_component_id"`
	ToComponentID   uuid.UUID `bun:"to_component_id,type:uuid,notnull" json:"to_component_id"`
}

type VulnerabilityComponentLink struct {
	bun.BaseModel `bun:"table:vulnerability_component_links"`

	ID              uuid.UUID `bun:",pk,type:uuid" json:"id"`
	VulnerabilityID uuid.UUID `bun:"vulnerability_id,type:uuid,notnull" json:"vulnerability_id"`
	ComponentID     uuid.UUID `bun:"component_id,type:uuid,notnull" json:"component_id"`
	MatchMethod     string    `bun:"match_method,type:text,notnull" json:"match_method"`
	Confidence      string    `bun:"confidence,type:text,notnull" json:"confidence"`
	CreatedAt       time.Time `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
}
