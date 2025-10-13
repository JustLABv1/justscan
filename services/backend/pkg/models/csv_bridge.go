package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// CSVBridge represents a bridge service for CSV file transfers
type CSVBridge struct {
	bun.BaseModel `bun:"table:csv_bridges,alias:cb"`

	ID            string    `bun:"id,pk,type:varchar(36)" json:"id"`
	ServiceID     string    `bun:"service_id,notnull,unique" json:"service_id"`
	ServiceName   string    `bun:"service_name,notnull" json:"service_name"`
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
}

// BeforeInsert sets the ID and timestamps before inserting
func (cb *CSVBridge) BeforeInsert() error {
	if cb.ID == "" {
		cb.ID = uuid.New().String()
	}
	now := time.Now()
	if cb.CreatedAt.IsZero() {
		cb.CreatedAt = now
	}
	if cb.UpdatedAt.IsZero() {
		cb.UpdatedAt = now
	}
	return nil
}

// BeforeUpdate sets the updated_at timestamp before updating
func (cb *CSVBridge) BeforeUpdate() error {
	cb.UpdatedAt = time.Now()
	return nil
}
