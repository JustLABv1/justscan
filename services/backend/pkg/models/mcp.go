package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// MCPActionIdempotency records a confirmed MCP action so retries cannot
// enqueue a second scan for the same caller, action, and key.
type MCPActionIdempotency struct {
	bun.BaseModel `bun:"table:mcp_action_idempotency"`

	ID             uuid.UUID  `bun:",pk,type:uuid" json:"id"`
	UserID         uuid.UUID  `bun:"user_id,type:uuid,notnull" json:"user_id"`
	Action         string     `bun:"action,type:text,notnull" json:"action"`
	IdempotencyKey string     `bun:"idempotency_key,type:text,notnull" json:"idempotency_key"`
	ResourceID     uuid.UUID  `bun:"resource_id,type:uuid,notnull" json:"resource_id"`
	ResultScanID   *uuid.UUID `bun:"result_scan_id,type:uuid" json:"result_scan_id,omitempty"`
	Status         string     `bun:"status,type:text,notnull,default:'running'" json:"status"`
	ErrorMessage   string     `bun:"error_message,type:text,notnull,default:''" json:"error_message,omitempty"`
	CreatedAt      time.Time  `bun:"created_at,type:timestamptz,notnull,default:now()" json:"created_at"`
	UpdatedAt      time.Time  `bun:"updated_at,type:timestamptz,notnull,default:now()" json:"updated_at"`
}

// MCPInteraction records metadata about one MCP tool call. It intentionally
// contains no prompts, tool arguments, tokens, or tool output.
type MCPInteraction struct {
	bun.BaseModel `bun:"table:mcp_interactions"`

	ID         uuid.UUID  `bun:",pk,type:uuid" json:"id"`
	UserID     *string    `bun:"user_id" json:"user_id,omitempty"`
	Transport  string     `bun:"transport,notnull" json:"transport"`
	ToolName   string     `bun:"tool_name,notnull" json:"tool_name"`
	Status     string     `bun:"status,notnull" json:"status"`
	DurationMs int        `bun:"duration_ms,notnull" json:"duration_ms"`
	Action     bool       `bun:"action,notnull" json:"action"`
	Replayed   bool       `bun:"replayed,notnull" json:"replayed"`
	ResourceID *uuid.UUID `bun:"resource_id" json:"resource_id,omitempty"`
	ErrorCode  string     `bun:"error_code,notnull" json:"error_code,omitempty"`
	CreatedAt  time.Time  `bun:"created_at,notnull,default:now()" json:"created_at"`
}
