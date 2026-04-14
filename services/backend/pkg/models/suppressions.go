package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Suppression struct {
	bun.BaseModel `bun:"table:suppressions"`

	ID            uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ImageDigest   string     `bun:"image_digest,type:text,notnull" json:"image_digest"`
	VulnID        string     `bun:"vuln_id,type:text,notnull" json:"vuln_id"`
	Status        string     `bun:"status,type:text,notnull" json:"status"`
	Justification string     `bun:"justification,type:text,default:''" json:"justification"`
	UserID        uuid.UUID  `bun:"user_id,type:uuid,notnull" json:"user_id"`
	ExpiresAt     *time.Time `bun:"expires_at,type:timestamptz" json:"expires_at"`
	CreatedAt     time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt     time.Time  `bun:"updated_at,type:timestamptz" json:"updated_at"`

	// Populated on join
	Username       string   `bun:"-" json:"username,omitempty"`
	Source         string   `bun:"-" json:"source,omitempty"`
	Sources        []string `bun:"-" json:"sources,omitempty"`
	ReadOnly       bool     `bun:"-" json:"read_only,omitempty"`
	XrayRuleID     string   `bun:"-" json:"xray_rule_id,omitempty"`
	XrayPolicyName string   `bun:"-" json:"xray_policy_name,omitempty"`
	XrayWatchName  string   `bun:"-" json:"xray_watch_name,omitempty"`
}

// Suppression status constants
const (
	SuppressionAccepted      = "accepted"
	SuppressionWontFix       = "wont_fix"
	SuppressionFalsePositive = "false_positive"
	SuppressionXrayIgnore    = "xray_ignore"
)
