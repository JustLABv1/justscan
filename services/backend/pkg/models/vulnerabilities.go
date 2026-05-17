package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Vulnerability struct {
	bun.BaseModel `bun:"table:vulnerabilities"`

	ID                         uuid.UUID    `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ScanID                     uuid.UUID    `bun:"scan_id,type:uuid,notnull" json:"scan_id"`
	VulnID                     string       `bun:"vuln_id,type:text,notnull" json:"vuln_id"`
	PkgName                    string       `bun:"pkg_name,type:text,notnull" json:"pkg_name"`
	InstalledVersion           string       `bun:"installed_version,type:text,default:''" json:"installed_version"`
	FixedVersion               string       `bun:"fixed_version,type:text,default:''" json:"fixed_version"`
	Severity                   string       `bun:"severity,type:text,notnull" json:"severity"`
	Title                      string       `bun:"title,type:text,default:''" json:"title"`
	Description                string       `bun:"description,type:text,default:''" json:"description"`
	References                 []string     `bun:"references,type:jsonb" json:"references"`
	DataSource                 string       `bun:"data_source,type:text,default:''" json:"data_source"`
	ExternalComponentID        string       `bun:"external_component_id,type:text,default:''" json:"external_component_id,omitempty"`
	XrayIssueID                string       `bun:"xray_issue_id,type:text,default:''" json:"xray_issue_id,omitempty"`
	XrayViolationID            string       `bun:"xray_violation_id,type:text,default:''" json:"xray_violation_id,omitempty"`
	XrayWatchName              string       `bun:"xray_watch_name,type:text,default:''" json:"xray_watch_name,omitempty"`
	XrayWatchNames             []string     `bun:"xray_watch_names,type:jsonb,notnull,default:'[]'" json:"xray_watch_names,omitempty"`
	XrayWatchPolicyMatches     []JSONObject `bun:"xray_watch_policy_matches,type:jsonb,notnull,default:'[]'" json:"xray_watch_policy_matches,omitempty"`
	XrayMatchedPolicies        []JSONObject `bun:"xray_matched_policies,type:jsonb,notnull,default:'[]'" json:"xray_matched_policies,omitempty"`
	XrayViolationPaths         []string     `bun:"xray_violation_paths,type:jsonb,notnull,default:'[]'" json:"xray_violation_paths,omitempty"`
	XrayComponentPhysicalPaths []string     `bun:"xray_component_physical_paths,type:jsonb,notnull,default:'[]'" json:"xray_component_physical_paths,omitempty"`
	XraySource                 string       `bun:"xray_source,type:text,default:''" json:"xray_source,omitempty"`
	XraySourceVersion          string       `bun:"xray_source_version,type:text,default:''" json:"xray_source_version,omitempty"`
	XraySourceID               string       `bun:"xray_source_id,type:text,default:''" json:"xray_source_id,omitempty"`
	XrayIsBlocking             bool         `bun:"xray_is_blocking,type:boolean,notnull,default:false" json:"xray_is_blocking,omitempty"`
	XrayViolationRaw           JSONObject   `bun:"xray_violation_raw,type:jsonb,notnull,default:'{}'" json:"xray_violation_raw,omitempty"`
	CVSSScore                  float64      `bun:"cvss_score,type:float,default:0" json:"cvss_score"`
	CVSSVector                 string       `bun:"cvss_vector,type:text,default:''" json:"cvss_vector"`
	CreatedAt                  time.Time    `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`

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
