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
	NotificationTypeDiscord  = "discord"
	NotificationTypeEmail    = "email"
	NotificationTypeWebhook  = "webhook"
	NotificationTypeSlack    = "slack"
	NotificationTypeTeams    = "teams"
	NotificationTypeTelegram = "telegram"

	NotificationScopeSystem = "system"
	NotificationScopeOrg    = "org"
	NotificationScopeUser   = "user"

	NotificationEventScanComplete     = "scan_complete"
	NotificationEventScanFailed       = "scan_failed"
	NotificationEventComplianceFailed = "compliance_failed"

	NotificationDeliveryModeImmediate = "immediate"
	NotificationDeliveryModeDigest    = "digest"

	NotificationQueueStatusPending    = "pending"
	NotificationQueueStatusLeased     = "leased"
	NotificationQueueStatusDelivered  = "delivered"
	NotificationQueueStatusFailed     = "failed"
	NotificationQueueStatusDeadLetter = "dead_letter"

	NotificationDigestStatusOpen      = "open"
	NotificationDigestStatusQueued    = "queued"
	NotificationDigestStatusDelivered = "delivered"
)

// NotificationConfig holds type-specific configuration stored as JSONB.
type NotificationConfig struct {
	// Discord / generic webhook
	WebhookURL string `json:"webhook_url,omitempty"`

	// Generic webhook extra headers
	Headers map[string]string `json:"headers,omitempty"`

	// Email (SMTP)
	SMTPHost     string   `json:"smtp_host,omitempty"`
	SMTPPort     int      `json:"smtp_port,omitempty"`
	SMTPUsername string   `json:"smtp_username,omitempty"`
	SMTPPassword string   `json:"smtp_password,omitempty"`
	SMTPFrom     string   `json:"smtp_from,omitempty"`
	ToAddresses  []string `json:"to_addresses,omitempty"`
	SMTPTLS      bool     `json:"smtp_tls,omitempty"`

	// Telegram
	TelegramBotToken string `json:"telegram_bot_token,omitempty"`
	TelegramChatID   string `json:"telegram_chat_id,omitempty"`
}

func (n NotificationConfig) Value() (driver.Value, error) {
	b, err := json.Marshal(n)
	return string(b), err
}

func (n *NotificationConfig) Scan(v interface{}) error {
	var b []byte
	switch t := v.(type) {
	case []byte:
		b = t
	case string:
		b = []byte(t)
	default:
		return fmt.Errorf("unexpected type %T", v)
	}
	return json.Unmarshal(b, n)
}

type NotificationChannel struct {
	bun.BaseModel `bun:"table:notification_channels"`

	ID            uuid.UUID          `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Name          string             `bun:"name,type:text,notnull" json:"name"`
	Type          string             `bun:"type,type:text,notnull" json:"type"`
	ScopeType     string             `bun:"scope_type,type:text,notnull,default:'system'" json:"scope_type"`
	ScopeRef      string             `bun:"scope_ref,type:text,notnull,default:''" json:"scope_ref"`
	Config        NotificationConfig `bun:"config,type:jsonb,default:'{}'" json:"config"`
	Enabled       bool               `bun:"enabled,type:bool,default:true" json:"enabled"`
	Events        StringList         `bun:"events,type:jsonb,default:'[]'" json:"events"`
	OrgIDs        StringList         `bun:"org_ids,type:jsonb,default:'[]'" json:"org_ids"`
	ImagePatterns StringList         `bun:"image_patterns,type:jsonb,default:'[]'" json:"image_patterns"`
	MinSeverity   string             `bun:"min_severity,type:text,default:''" json:"min_severity"`
	CreatedAt     time.Time          `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt     time.Time          `bun:"updated_at,type:timestamptz" json:"updated_at"`
}

type NotificationRule struct {
	bun.BaseModel `bun:"table:notification_rules"`

	ID                  uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Name                string     `bun:"name,type:text,notnull" json:"name"`
	ScopeType           string     `bun:"scope_type,type:text,notnull" json:"scope_type"`
	ScopeRef            string     `bun:"scope_ref,type:text,notnull,default:''" json:"scope_ref"`
	Enabled             bool       `bun:"enabled,type:bool,notnull,default:true" json:"enabled"`
	ChannelIDs          StringList `bun:"channel_ids,type:jsonb,notnull,default:'[]'" json:"channel_ids"`
	EventTypes          StringList `bun:"event_types,type:jsonb,notnull,default:'[]'" json:"event_types"`
	Conditions          JSONObject `bun:"conditions,type:jsonb,notnull,default:'{}'" json:"conditions"`
	DeliveryMode        string     `bun:"delivery_mode,type:text,notnull,default:'immediate'" json:"delivery_mode"`
	DigestWindowMinutes int        `bun:"digest_window_minutes,type:int,notnull,default:0" json:"digest_window_minutes"`
	CreatedAt           time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt           time.Time  `bun:"updated_at,type:timestamptz,default:now()" json:"updated_at"`
}

type NotificationEvent struct {
	bun.BaseModel `bun:"table:notification_events"`

	ID         uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Event      string     `bun:"event,type:text,notnull" json:"event"`
	ScanID     *uuid.UUID `bun:"scan_id,type:uuid" json:"scan_id,omitempty"`
	Payload    JSONObject `bun:"payload,type:jsonb,notnull,default:'{}'" json:"payload"`
	MatchedAt  *time.Time `bun:"matched_at,type:timestamptz" json:"matched_at,omitempty"`
	CreatedAt  time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	OccurredAt time.Time  `bun:"occurred_at,type:timestamptz,default:now()" json:"occurred_at"`
}

type NotificationQueueJob struct {
	bun.BaseModel `bun:"table:notification_queue_jobs"`

	ID              uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	EventID         *uuid.UUID `bun:"event_id,type:uuid" json:"event_id,omitempty"`
	RuleID          uuid.UUID  `bun:"rule_id,type:uuid,notnull" json:"rule_id"`
	ChannelID       uuid.UUID  `bun:"channel_id,type:uuid,notnull" json:"channel_id"`
	DigestID        *uuid.UUID `bun:"digest_id,type:uuid" json:"digest_id,omitempty"`
	ScopeType       string     `bun:"scope_type,type:text,notnull" json:"scope_type"`
	ScopeRef        string     `bun:"scope_ref,type:text,notnull,default:''" json:"scope_ref"`
	DeliveryMode    string     `bun:"delivery_mode,type:text,notnull,default:'immediate'" json:"delivery_mode"`
	Status          string     `bun:"status,type:text,notnull,default:'pending'" json:"status"`
	AttemptCount    int        `bun:"attempt_count,type:int,notnull,default:0" json:"attempt_count"`
	MaxAttempts     int        `bun:"max_attempts,type:int,notnull,default:5" json:"max_attempts"`
	NextAttemptAt   time.Time  `bun:"next_attempt_at,type:timestamptz,notnull,default:now()" json:"next_attempt_at"`
	LeaseOwner      string     `bun:"lease_owner,type:text,notnull,default:''" json:"lease_owner"`
	LeasedUntil     *time.Time `bun:"leased_until,type:timestamptz" json:"leased_until,omitempty"`
	IdempotencyKey  string     `bun:"idempotency_key,type:text,notnull" json:"idempotency_key"`
	Payload         JSONObject `bun:"payload,type:jsonb,notnull,default:'{}'" json:"payload"`
	LastError       string     `bun:"last_error,type:text,notnull,default:''" json:"last_error"`
	LastAttemptAt   *time.Time `bun:"last_attempt_at,type:timestamptz" json:"last_attempt_at,omitempty"`
	DeliveredAt     *time.Time `bun:"delivered_at,type:timestamptz" json:"delivered_at,omitempty"`
	CreatedAt       time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt       time.Time  `bun:"updated_at,type:timestamptz,default:now()" json:"updated_at"`
	ChannelName     string     `bun:"channel_name,scanonly" json:"channel_name,omitempty"`
	RuleName        string     `bun:"rule_name,scanonly" json:"rule_name,omitempty"`
}

type NotificationDigest struct {
	bun.BaseModel `bun:"table:notification_digests"`

	ID                  uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	RuleID              uuid.UUID  `bun:"rule_id,type:uuid,notnull" json:"rule_id"`
	ChannelID           uuid.UUID  `bun:"channel_id,type:uuid,notnull" json:"channel_id"`
	ScopeType           string     `bun:"scope_type,type:text,notnull" json:"scope_type"`
	ScopeRef            string     `bun:"scope_ref,type:text,notnull,default:''" json:"scope_ref"`
	WindowStart         time.Time  `bun:"window_start,type:timestamptz,notnull" json:"window_start"`
	WindowEnd           time.Time  `bun:"window_end,type:timestamptz,notnull" json:"window_end"`
	Status              string     `bun:"status,type:text,notnull,default:'open'" json:"status"`
	EventIDs            StringList `bun:"event_ids,type:jsonb,notnull,default:'[]'" json:"event_ids"`
	EventCount          int        `bun:"event_count,type:int,notnull,default:0" json:"event_count"`
	LastEventAt         *time.Time `bun:"last_event_at,type:timestamptz" json:"last_event_at,omitempty"`
	QueueJobID          *uuid.UUID `bun:"queue_job_id,type:uuid" json:"queue_job_id,omitempty"`
	DeliveredAt         *time.Time `bun:"delivered_at,type:timestamptz" json:"delivered_at,omitempty"`
	CreatedAt           time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt           time.Time  `bun:"updated_at,type:timestamptz,default:now()" json:"updated_at"`
	RuleName            string     `bun:"rule_name,scanonly" json:"rule_name,omitempty"`
	ChannelName         string     `bun:"channel_name,scanonly" json:"channel_name,omitempty"`
}

type NotificationDelivery struct {
	bun.BaseModel `bun:"table:notification_delivery_logs"`

	ID          uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ChannelID   uuid.UUID  `bun:"channel_id,type:uuid,notnull" json:"channel_id"`
	RuleID      *uuid.UUID `bun:"rule_id,type:uuid" json:"rule_id,omitempty"`
	EventID     *uuid.UUID `bun:"event_id,type:uuid" json:"event_id,omitempty"`
	QueueJobID  *uuid.UUID `bun:"queue_job_id,type:uuid" json:"queue_job_id,omitempty"`
	Event       string     `bun:"event,type:text,notnull" json:"event"`
	TriggeredBy string     `bun:"triggered_by,type:text,notnull,default:'dispatch'" json:"triggered_by"`
	Status      string     `bun:"status,type:text,notnull" json:"status"`
	Error       string     `bun:"error,type:text,default:''" json:"error"`
	Details     string     `bun:"details,type:text,default:''" json:"details"`
	ScopeType   string     `bun:"scope_type,type:text,notnull,default:'system'" json:"scope_type"`
	ScopeRef    string     `bun:"scope_ref,type:text,notnull,default:''" json:"scope_ref"`
	CreatedAt   time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	ChannelName string     `bun:"channel_name,scanonly" json:"channel_name,omitempty"`
	RuleName    string     `bun:"rule_name,scanonly" json:"rule_name,omitempty"`
}
