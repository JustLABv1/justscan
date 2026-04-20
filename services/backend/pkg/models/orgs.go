package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type StringList []string

func (s StringList) Value() (driver.Value, error) {
	if s == nil {
		return "[]", nil
	}
	b, err := json.Marshal(s)
	return string(b), err
}

func (s *StringList) Scan(v interface{}) error {
	var b []byte
	switch t := v.(type) {
	case []byte:
		b = t
	case string:
		b = []byte(t)
	default:
		return fmt.Errorf("unexpected type %T", v)
	}
	return json.Unmarshal(b, s)
}

type Org struct {
	bun.BaseModel `bun:"table:orgs"`

	ID              uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Name            string     `bun:"name,type:text,notnull,unique" json:"name"`
	Description     string     `bun:"description,type:text,default:''" json:"description"`
	ImagePatterns   StringList `bun:"image_patterns,type:jsonb,default:'[]'" json:"image_patterns"`
	CreatedByID     uuid.UUID  `bun:"created_by_id,type:uuid,notnull" json:"created_by_id"`
	CreatedAt       time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt       time.Time  `bun:"updated_at,type:timestamptz" json:"updated_at"`
	CurrentUserRole string     `bun:"-" json:"current_user_role,omitempty"`

	Policies []OrgPolicy `bun:"rel:has-many,join:id=org_id" json:"policies,omitempty"`
}

const (
	OrgRoleOwner  = "owner"
	OrgRoleAdmin  = "admin"
	OrgRoleEditor = "editor"
	OrgRoleViewer = "viewer"
)

type OrgMember struct {
	bun.BaseModel `bun:"table:org_members"`

	OrgID     uuid.UUID `bun:"org_id,pk,type:uuid,notnull" json:"org_id"`
	UserID    uuid.UUID `bun:"user_id,pk,type:uuid,notnull" json:"user_id"`
	Role      string    `bun:"role,type:text,notnull,default:'viewer'" json:"role"`
	JoinedAt  time.Time `bun:"joined_at,type:timestamptz,notnull,default:now()" json:"joined_at"`
	CreatedAt time.Time `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt time.Time `bun:"updated_at,type:timestamptz,default:now()" json:"updated_at"`
	Email     string    `bun:"-" json:"email,omitempty"`
	Username  string    `bun:"-" json:"username,omitempty"`
}

type OrgInvite struct {
	bun.BaseModel `bun:"table:org_invites"`

	ID               uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	OrgID            uuid.UUID  `bun:"org_id,type:uuid,notnull" json:"org_id"`
	Email            string     `bun:"email,type:text,notnull" json:"email"`
	Role             string     `bun:"role,type:text,notnull,default:'viewer'" json:"role"`
	Token            string     `bun:"token,type:varchar(64),notnull,unique" json:"token"`
	InvitedByUserID  uuid.UUID  `bun:"invited_by_user_id,type:uuid,notnull" json:"invited_by_user_id"`
	AcceptedByUserID *uuid.UUID `bun:"accepted_by_user_id,type:uuid" json:"accepted_by_user_id,omitempty"`
	AcceptedAt       *time.Time `bun:"accepted_at,type:timestamptz" json:"accepted_at,omitempty"`
	RevokedAt        *time.Time `bun:"revoked_at,type:timestamptz" json:"revoked_at,omitempty"`
	ExpiresAt        time.Time  `bun:"expires_at,type:timestamptz,notnull" json:"expires_at"`
	CreatedAt        time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt        time.Time  `bun:"updated_at,type:timestamptz,default:now()" json:"updated_at"`
	OrgName          string     `bun:"-" json:"org_name,omitempty"`
	OrgDescription   string     `bun:"-" json:"org_description,omitempty"`
	InvitedByEmail   string     `bun:"-" json:"invited_by_email,omitempty"`
	InvitedByName    string     `bun:"-" json:"invited_by_username,omitempty"`
}

type ComplianceHistory struct {
	bun.BaseModel `bun:"table:compliance_history"`

	ID          uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ScanID      uuid.UUID `bun:"scan_id,type:uuid,notnull" json:"scan_id"`
	PolicyID    uuid.UUID `bun:"policy_id,type:uuid,notnull" json:"policy_id"`
	OrgID       uuid.UUID `bun:"org_id,type:uuid,notnull" json:"org_id"`
	Status      string    `bun:"status,type:text,notnull" json:"status"`
	EvaluatedAt time.Time `bun:"evaluated_at,type:timestamptz,default:now()" json:"evaluated_at"`
}

type PolicyRule struct {
	Type     string  `json:"type"`               // max_cvss, max_count, max_total, require_fix, blocked_cve
	Value    float64 `json:"value,omitempty"`    // numeric threshold
	Severity string  `json:"severity,omitempty"` // for max_count, require_fix
	CVEID    string  `json:"cve_id,omitempty"`   // for blocked_cve
}

type PolicyRuleList []PolicyRule

func (r PolicyRuleList) Value() (driver.Value, error) {
	b, err := json.Marshal(r)
	return string(b), err
}

func (r *PolicyRuleList) Scan(v interface{}) error {
	var b []byte
	switch t := v.(type) {
	case []byte:
		b = t
	case string:
		b = []byte(t)
	default:
		return fmt.Errorf("unexpected type %T", v)
	}
	return json.Unmarshal(b, r)
}

type OrgPolicy struct {
	bun.BaseModel `bun:"table:org_policies"`

	ID        uuid.UUID      `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	OrgID     uuid.UUID      `bun:"org_id,type:uuid,notnull" json:"org_id"`
	Name      string         `bun:"name,type:text,notnull" json:"name"`
	Rules     PolicyRuleList `bun:"rules,type:jsonb" json:"rules"`
	CreatedAt time.Time      `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt time.Time      `bun:"updated_at,type:timestamptz" json:"updated_at"`
}

type OrgScan struct {
	bun.BaseModel `bun:"table:org_scans"`

	OrgID  uuid.UUID `bun:"org_id,type:uuid,notnull" json:"org_id"`
	ScanID uuid.UUID `bun:"scan_id,type:uuid,notnull" json:"scan_id"`
}

type OrgRegistry struct {
	bun.BaseModel `bun:"table:org_registries"`

	OrgID      uuid.UUID `bun:"org_id,type:uuid,notnull" json:"org_id"`
	RegistryID uuid.UUID `bun:"registry_id,type:uuid,notnull" json:"registry_id"`
}

type OrgWatchlistItem struct {
	bun.BaseModel `bun:"table:org_watchlist_items"`

	OrgID           uuid.UUID `bun:"org_id,type:uuid,notnull" json:"org_id"`
	WatchlistItemID uuid.UUID `bun:"watchlist_item_id,type:uuid,notnull" json:"watchlist_item_id"`
}

type OrgTag struct {
	bun.BaseModel `bun:"table:org_tags"`

	OrgID uuid.UUID `bun:"org_id,type:uuid,notnull" json:"org_id"`
	TagID uuid.UUID `bun:"tag_id,type:uuid,notnull" json:"tag_id"`
}

type OrgSuppression struct {
	bun.BaseModel `bun:"table:org_suppressions"`

	OrgID         uuid.UUID `bun:"org_id,type:uuid,notnull" json:"org_id"`
	SuppressionID uuid.UUID `bun:"suppression_id,type:uuid,notnull" json:"suppression_id"`
}

type OrgStatusPage struct {
	bun.BaseModel `bun:"table:org_status_pages"`

	OrgID        uuid.UUID `bun:"org_id,type:uuid,notnull" json:"org_id"`
	StatusPageID uuid.UUID `bun:"status_page_id,type:uuid,notnull" json:"status_page_id"`
}

type Violation struct {
	Rule    PolicyRule `json:"rule"`
	Message string     `json:"message"`
	VulnID  string     `json:"vuln_id,omitempty"`
}

type ViolationList []Violation

func (v ViolationList) Value() (driver.Value, error) {
	b, err := json.Marshal(v)
	return string(b), err
}

func (v *ViolationList) Scan(src interface{}) error {
	var b []byte
	switch t := src.(type) {
	case []byte:
		b = t
	case string:
		b = []byte(t)
	default:
		return fmt.Errorf("unexpected type %T", src)
	}
	return json.Unmarshal(b, v)
}

type ComplianceResult struct {
	bun.BaseModel `bun:"table:compliance_results"`

	ID          uuid.UUID     `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ScanID      uuid.UUID     `bun:"scan_id,type:uuid,notnull" json:"scan_id"`
	PolicyID    uuid.UUID     `bun:"policy_id,type:uuid,notnull" json:"policy_id"`
	OrgID       uuid.UUID     `bun:"org_id,type:uuid,notnull" json:"org_id"`
	Status      string        `bun:"status,type:text,notnull" json:"status"` // pass, fail
	Violations  ViolationList `bun:"violations,type:jsonb" json:"violations"`
	EvaluatedAt time.Time     `bun:"evaluated_at,type:timestamptz,default:now()" json:"evaluated_at"`

	PolicyName string `bun:"-" json:"policy_name,omitempty"`
	OrgName    string `bun:"-" json:"org_name,omitempty"`
}
