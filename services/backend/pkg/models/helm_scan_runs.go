package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type HelmScanRun struct {
	bun.BaseModel `bun:"table:helm_scan_runs"`

	ID           uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	UserID       *uuid.UUID `bun:"user_id,type:uuid" json:"user_id,omitempty"`
	ChartURL     string     `bun:"chart_url,type:text,notnull" json:"chart_url"`
	ChartName    string     `bun:"chart_name,type:text,default:''" json:"chart_name,omitempty"`
	ChartVersion string     `bun:"chart_version,type:text,default:''" json:"chart_version,omitempty"`
	Platform     string     `bun:"platform,type:text,default:''" json:"platform,omitempty"`
	CreatedAt    time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
}
