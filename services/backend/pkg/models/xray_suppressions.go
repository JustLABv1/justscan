package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type XraySuppression struct {
	bun.BaseModel `bun:"table:xray_suppressions"`

	ID            uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ScanID        uuid.UUID  `bun:"scan_id,type:uuid,notnull" json:"scan_id"`
	ImageDigest   string     `bun:"image_digest,type:text,notnull,default:''" json:"image_digest"`
	VulnID        string     `bun:"vuln_id,type:text,notnull" json:"vuln_id"`
	RuleID        string     `bun:"rule_id,type:text,notnull,default:''" json:"rule_id"`
	PolicyName    string     `bun:"policy_name,type:text,notnull,default:''" json:"policy_name"`
	WatchName     string     `bun:"watch_name,type:text,notnull,default:''" json:"watch_name"`
	Justification string     `bun:"justification,type:text,notnull,default:''" json:"justification"`
	ArtifactPath  string     `bun:"artifact_path,type:text,notnull,default:''" json:"artifact_path"`
	ExpiresAt     *time.Time `bun:"expires_at,type:timestamptz" json:"expires_at"`
	Raw           JSONObject `bun:"raw,type:jsonb,notnull,default:'{}'" json:"raw,omitempty"`
	CreatedAt     time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt     time.Time  `bun:"updated_at,type:timestamptz,default:now()" json:"updated_at"`
}
