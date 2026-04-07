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
	NotificationTypeDiscord = "discord"
	NotificationTypeEmail   = "email"
	NotificationTypeWebhook = "webhook"

	NotificationEventScanComplete     = "scan_complete"
	NotificationEventScanFailed       = "scan_failed"
	NotificationEventComplianceFailed = "compliance_failed"
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

	ID        uuid.UUID          `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Name      string             `bun:"name,type:text,notnull" json:"name"`
	Type      string             `bun:"type,type:text,notnull" json:"type"`
	Config    NotificationConfig `bun:"config,type:jsonb,default:'{}'" json:"config"`
	Enabled   bool               `bun:"enabled,type:bool,default:true" json:"enabled"`
	Events    StringList         `bun:"events,type:jsonb,default:'[]'" json:"events"`
	CreatedAt time.Time          `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt time.Time          `bun:"updated_at,type:timestamptz" json:"updated_at"`
}

type NotificationDelivery struct {
	bun.BaseModel `bun:"table:notification_delivery_logs"`

	ID          uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ChannelID   uuid.UUID `bun:"channel_id,type:uuid,notnull" json:"channel_id"`
	Event       string    `bun:"event,type:text,notnull" json:"event"`
	TriggeredBy string    `bun:"triggered_by,type:text,notnull,default:'dispatch'" json:"triggered_by"`
	Status      string    `bun:"status,type:text,notnull" json:"status"`
	Error       string    `bun:"error,type:text,default:''" json:"error"`
	Details     string    `bun:"details,type:text,default:''" json:"details"`
	CreatedAt   time.Time `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	ChannelName string    `bun:"channel_name,scanonly" json:"channel_name,omitempty"`
}
