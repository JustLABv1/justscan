package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type XRayRequestLog struct {
	bun.BaseModel `bun:"table:xray_request_logs"`

	ID         uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ScanID     *uuid.UUID `bun:"scan_id,type:uuid" json:"scan_id,omitempty"`
	RegistryID *uuid.UUID `bun:"registry_id,type:uuid" json:"registry_id,omitempty"`
	Method     string     `bun:"method,type:text,notnull" json:"method"`
	Endpoint   string     `bun:"endpoint,type:text,notnull" json:"endpoint"`
	StatusCode int        `bun:"status_code,notnull" json:"status_code"`
	DurationMs int        `bun:"duration_ms,notnull" json:"duration_ms"`
	Error      *string    `bun:"error,type:text" json:"error,omitempty"`
	CreatedAt  time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
}

type XRayUsageStats struct {
	TotalRequests   int64          `json:"total_requests"`
	ErrorRequests   int64          `json:"error_requests"`
	AvgDurationMs   float64        `json:"avg_duration_ms"`
	P95DurationMs   float64        `json:"p95_duration_ms"`
	TopEndpoints    []EndpointStat `json:"top_endpoints"`
	StatusBreakdown []StatusBucket `json:"status_breakdown"`
}
