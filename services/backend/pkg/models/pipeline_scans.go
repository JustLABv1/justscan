package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

const (
	PipelineSourceGeneric       = "generic"
	PipelineSourceGitHubActions = "github_actions"
	PipelineSourceGitLabCI      = "gitlab_ci"
	PipelineSourceN8N           = "n8n"
)

const (
	PipelineCallbackStatusAwaitingTerminal = "awaiting_terminal"
	PipelineCallbackStatusPending          = "pending"
	PipelineCallbackStatusDelivered        = "delivered"
	PipelineCallbackStatusFailed           = "failed"
)

const (
	PipelineVerdictPending = "pending"
	PipelineVerdictPass    = "pass"
	PipelineVerdictFail    = "fail"
	PipelineVerdictError   = "error"
)

type PipelineVerdictConfig struct {
	FailOnSeverity  string `json:"fail_on_severity"`
	FailOnScanError bool   `json:"fail_on_scan_error"`
	FailOnXrayBlock bool   `json:"fail_on_xray_block"`
}

func (c PipelineVerdictConfig) Value() (driver.Value, error) {
	b, err := json.Marshal(c)
	return string(b), err
}

func (c *PipelineVerdictConfig) Scan(src interface{}) error {
	if c == nil {
		return nil
	}

	var b []byte
	switch t := src.(type) {
	case []byte:
		b = t
	case string:
		b = []byte(t)
	case nil:
		*c = PipelineVerdictConfig{}
		return nil
	default:
		return fmt.Errorf("unexpected type %T", src)
	}

	if len(b) == 0 {
		*c = PipelineVerdictConfig{}
		return nil
	}

	return json.Unmarshal(b, c)
}

type PipelineScanRequest struct {
	bun.BaseModel `bun:"table:pipeline_scan_requests"`

	ID                      uuid.UUID             `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ScanID                  uuid.UUID             `bun:"scan_id,type:uuid,notnull,unique" json:"scan_id"`
	OrgID                   uuid.UUID             `bun:"org_id,type:uuid,notnull" json:"org_id"`
	Source                  string                `bun:"source,type:text,notnull,default:'generic'" json:"source"`
	ExternalRef             string                `bun:"external_ref,type:text,notnull,default:''" json:"external_ref,omitempty"`
	CallbackURL             string                `bun:"callback_url,type:text,notnull,default:''" json:"callback_url,omitempty"`
	EncryptedCallbackSecret string                `bun:"encrypted_callback_secret,type:text,notnull,default:''" json:"-"`
	VerdictConfig           PipelineVerdictConfig `bun:"verdict_config,type:jsonb,notnull,default:'{}'" json:"verdict_config"`
	CallbackEvent           string                `bun:"callback_event,type:text,notnull,default:''" json:"callback_event,omitempty"`
	DeliveryStatus          string                `bun:"delivery_status,type:text,notnull,default:'awaiting_terminal'" json:"delivery_status"`
	DeliveryAttemptCount    int                   `bun:"delivery_attempt_count,type:int,notnull,default:0" json:"delivery_attempt_count"`
	LastDeliveryError       string                `bun:"last_delivery_error,type:text,notnull,default:''" json:"last_delivery_error,omitempty"`
	LastAttemptAt           *time.Time            `bun:"last_attempt_at,type:timestamptz" json:"last_attempt_at,omitempty"`
	DeliveredAt             *time.Time            `bun:"delivered_at,type:timestamptz" json:"delivered_at,omitempty"`
	NextAttemptAt           *time.Time            `bun:"next_attempt_at,type:timestamptz" json:"next_attempt_at,omitempty"`
	CreatedAt               time.Time             `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt               time.Time             `bun:"updated_at,type:timestamptz,default:now()" json:"updated_at"`
}
