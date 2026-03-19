package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type ManualFinding struct {
	bun.BaseModel `bun:"table:scan_manual_findings"`

	ID               uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ScanID           uuid.UUID `bun:"scan_id,type:uuid,notnull" json:"scan_id"`
	VulnID           string    `bun:"vuln_id,type:text,default:''" json:"vuln_id"`
	Severity         string    `bun:"severity,type:text,default:'UNKNOWN'" json:"severity"`
	PkgName          string    `bun:"pkg_name,type:text,default:''" json:"pkg_name"`
	InstalledVersion string    `bun:"installed_version,type:text,default:''" json:"installed_version"`
	FixedVersion     string    `bun:"fixed_version,type:text,default:''" json:"fixed_version"`
	Title            string    `bun:"title,type:text,default:''" json:"title"`
	Description      string    `bun:"description,type:text,default:''" json:"description"`
	CVSSScore        float64   `bun:"cvss_score,type:float,default:0" json:"cvss_score"`
	Justification    string    `bun:"justification,type:text,default:''" json:"justification"`
	CreatedBy        uuid.UUID `bun:"created_by,type:uuid,notnull" json:"created_by"`
	CreatedAt        time.Time `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt        time.Time `bun:"updated_at,type:timestamptz" json:"updated_at"`
}
