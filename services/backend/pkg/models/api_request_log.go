package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type APIRequestLog struct {
	bun.BaseModel `bun:"table:api_request_logs"`

	ID         uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	UserID     *string   `bun:"user_id,type:text" json:"user_id,omitempty"`
	Method     string    `bun:"method,type:text,notnull" json:"method"`
	Path       string    `bun:"path,type:text,notnull" json:"path"`
	StatusCode int       `bun:"status_code,notnull" json:"status_code"`
	DurationMs int       `bun:"duration_ms,notnull" json:"duration_ms"`
	CreatedAt  time.Time `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
}

type APIRequestLogWithUser struct {
	bun.BaseModel `bun:"table:api_request_logs"`

	ID         uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	UserID     *string   `bun:"user_id,type:text" json:"user_id,omitempty"`
	Method     string    `bun:"method,type:text,notnull" json:"method"`
	Path       string    `bun:"path,type:text,notnull" json:"path"`
	StatusCode int       `bun:"status_code,notnull" json:"status_code"`
	DurationMs int       `bun:"duration_ms,notnull" json:"duration_ms"`
	CreatedAt  time.Time `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	Username   string    `bun:"username,type:text" json:"username"`
	Email      string    `bun:"email,type:text" json:"email"`
}

type APIUsageStats struct {
	TotalRequests   int64          `json:"total_requests"`
	ErrorRequests   int64          `json:"error_requests"`
	AvgDurationMs   float64        `json:"avg_duration_ms"`
	P95DurationMs   float64        `json:"p95_duration_ms"`
	TopEndpoints    []EndpointStat `json:"top_endpoints"`
	TopUsers        []UserStat     `json:"top_users"`
	StatusBreakdown []StatusBucket `json:"status_breakdown"`
}

type EndpointStat struct {
	Method string `bun:"method" json:"method"`
	Path   string `bun:"path" json:"path"`
	Count  int64  `bun:"count" json:"count"`
}

type UserStat struct {
	UserID   *string `bun:"user_id" json:"user_id,omitempty"`
	Username string  `bun:"username" json:"username"`
	Count    int64   `bun:"count" json:"count"`
}

type StatusBucket struct {
	StatusCode int   `bun:"status_code" json:"status_code"`
	Count      int64 `bun:"count" json:"count"`
}
