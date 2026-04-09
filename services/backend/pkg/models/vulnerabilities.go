package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Vulnerability struct {
	bun.BaseModel `bun:"table:vulnerabilities"`

	ID                  uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ScanID              uuid.UUID `bun:"scan_id,type:uuid,notnull" json:"scan_id"`
	VulnID              string    `bun:"vuln_id,type:text,notnull" json:"vuln_id"`
	PkgName             string    `bun:"pkg_name,type:text,notnull" json:"pkg_name"`
	InstalledVersion    string    `bun:"installed_version,type:text,default:''" json:"installed_version"`
	FixedVersion        string    `bun:"fixed_version,type:text,default:''" json:"fixed_version"`
	Severity            string    `bun:"severity,type:text,notnull" json:"severity"`
	Title               string    `bun:"title,type:text,default:''" json:"title"`
	Description         string    `bun:"description,type:text,default:''" json:"description"`
	References          []string  `bun:"references,type:jsonb" json:"references"`
	DataSource          string    `bun:"data_source,type:text,default:''" json:"data_source"`
	ExternalComponentID string    `bun:"external_component_id,type:text,default:''" json:"external_component_id,omitempty"`
	CVSSScore           float64   `bun:"cvss_score,type:float,default:0" json:"cvss_score"`
	CVSSVector          string    `bun:"cvss_vector,type:text,default:''" json:"cvss_vector"`
	CreatedAt           time.Time `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`

	// Relations (populated on join)
	Suppression *Suppression `bun:"-" json:"suppression,omitempty"`
	Comments    []Comment    `bun:"rel:has-many,join:id=vulnerability_id" json:"comments,omitempty"`
	KBEntry     *VulnKBEntry `bun:"-" json:"kb,omitempty"`
}

// Severity constants
const (
	SeverityCritical = "CRITICAL"
	SeverityHigh     = "HIGH"
	SeverityMedium   = "MEDIUM"
	SeverityLow      = "LOW"
	SeverityUnknown  = "UNKNOWN"
)
