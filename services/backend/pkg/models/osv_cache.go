package models

import (
	"time"

	"github.com/uptrace/bun"
)

type OSVPackageCache struct {
	bun.BaseModel `bun:"table:osv_package_cache"`

	Ecosystem string              `bun:"ecosystem,type:text,pk" json:"ecosystem"`
	Name      string              `bun:"name,type:text,pk" json:"name"`
	Version   string              `bun:"version,type:text,pk" json:"version"`
	Findings  []OSVPackageFinding `bun:"findings,type:jsonb,notnull,default:'[]'" json:"findings"`
	FetchedAt time.Time           `bun:"fetched_at,type:timestamptz,default:now()" json:"fetched_at"`
}

type OSVPackageFinding struct {
	VulnID       string     `json:"vuln_id"`
	Aliases      []string   `json:"aliases,omitempty"`
	Summary      string     `json:"summary"`
	Details      string     `json:"details"`
	Severity     string     `json:"severity"`
	FixedVersion string     `json:"fixed_version"`
	PublishedAt  *time.Time `json:"published_at,omitempty"`
	ModifiedAt   *time.Time `json:"modified_at,omitempty"`
	References   []KBRef    `json:"references,omitempty"`
	SourceID     string     `json:"source_id,omitempty"`
	SourceURL    string     `json:"source_url,omitempty"`
}
