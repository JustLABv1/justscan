package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// CSVBridge represents a bridge for CSV file transfers
type CSVBridge struct {
	bun.BaseModel `bun:"table:csv_bridges,alias:cb"`

	ID            uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	BridgeID      string    `bun:"bridge_id,notnull,unique" json:"bridge_id"`
	BridgeName    string    `bun:"bridge_name,notnull" json:"bridge_name"`
	Version       string    `bun:"version" json:"version"`
	UploadURL     string    `bun:"upload_url,notnull" json:"upload_url"`
	HealthURL     string    `bun:"health_url,notnull" json:"health_url"`
	APIKey        string    `bun:"api_key,notnull" json:"api_key"`
	MaxFileSize   int64     `bun:"max_file_size" json:"max_file_size"`
	IsActive      bool      `bun:"is_active,notnull,default:true" json:"is_active"`
	IsHealthy     bool      `bun:"-" json:"is_healthy"` // Computed field, not stored
	LastHeartbeat time.Time `bun:"last_heartbeat" json:"last_heartbeat"`
	CreatedAt     time.Time `bun:"created_at,nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt     time.Time `bun:"updated_at,nullzero,notnull,default:current_timestamp" json:"updated_at"`
	Reachable     bool      `bun:"reachable,default:false" json:"reachable"`
}
