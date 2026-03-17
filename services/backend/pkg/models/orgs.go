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

	ID            uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Name          string     `bun:"name,type:text,notnull,unique" json:"name"`
	Description   string     `bun:"description,type:text,default:''" json:"description"`
	ImagePatterns StringList `bun:"image_patterns,type:jsonb,default:'[]'" json:"image_patterns"`
	CreatedByID   uuid.UUID  `bun:"created_by_id,type:uuid,notnull" json:"created_by_id"`
	CreatedAt     time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt     time.Time  `bun:"updated_at,type:timestamptz" json:"updated_at"`

	Policies []OrgPolicy `bun:"rel:has-many,join:id=org_id" json:"policies,omitempty"`
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
