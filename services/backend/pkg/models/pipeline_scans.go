package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

const (
	PipelineSourceGeneric       = "generic"
	PipelineSourceJustScanCLI   = "justscan_cli"
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

type PipelineScanRequest struct {
	bun.BaseModel `bun:"table:pipeline_scan_requests"`

	ID                        uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ScanID                    uuid.UUID  `bun:"scan_id,type:uuid,notnull,unique" json:"scan_id"`
	OrgID                     uuid.UUID  `bun:"org_id,type:uuid,notnull" json:"org_id"`
	Source                    string     `bun:"source,type:text,notnull,default:'generic'" json:"source"`
	InitiatorTokenID          *uuid.UUID `bun:"initiator_token_id,type:uuid" json:"initiator_token_id,omitempty"`
	InitiatorTokenDescription string     `bun:"initiator_token_description,type:text,notnull,default:''" json:"initiator_token_description,omitempty"`
	ExternalRef               string     `bun:"external_ref,type:text,notnull,default:''" json:"external_ref,omitempty"`
	CallbackURL               string     `bun:"callback_url,type:text,notnull,default:''" json:"callback_url,omitempty"`
	EncryptedCallbackSecret   string     `bun:"encrypted_callback_secret,type:text,notnull,default:''" json:"-"`
	CallbackEvent             string     `bun:"callback_event,type:text,notnull,default:''" json:"callback_event,omitempty"`
	DeliveryStatus            string     `bun:"delivery_status,type:text,notnull,default:'awaiting_terminal'" json:"delivery_status"`
	DeliveryAttemptCount      int        `bun:"delivery_attempt_count,type:int,notnull,default:0" json:"delivery_attempt_count"`
	LastDeliveryError         string     `bun:"last_delivery_error,type:text,notnull,default:''" json:"last_delivery_error,omitempty"`
	LastAttemptAt             *time.Time `bun:"last_attempt_at,type:timestamptz" json:"last_attempt_at,omitempty"`
	DeliveredAt               *time.Time `bun:"delivered_at,type:timestamptz" json:"delivered_at,omitempty"`
	NextAttemptAt             *time.Time `bun:"next_attempt_at,type:timestamptz" json:"next_attempt_at,omitempty"`
	CreatedAt                 time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt                 time.Time  `bun:"updated_at,type:timestamptz,default:now()" json:"updated_at"`
}

// PipelineInitiator identifies the credential that submitted a pipeline scan.
// The description is stored with the scan request so the audit trail remains
// useful after the corresponding token is revoked or renamed.
type PipelineInitiator struct {
	Source           string     `json:"source"`
	TokenID          *uuid.UUID `json:"token_id,omitempty"`
	TokenDescription string     `json:"token_description,omitempty"`
}
