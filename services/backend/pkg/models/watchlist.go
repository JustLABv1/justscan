package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type WatchlistItem struct {
	bun.BaseModel `bun:"table:watchlist_items"`

	ID            uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ImageName     string     `bun:"image_name,type:text,notnull" json:"image_name"`
	ImageTag      string     `bun:"image_tag,type:text,notnull" json:"image_tag"`
	Schedule      string     `bun:"schedule,type:text,notnull,default:'0 2 * * *'" json:"schedule"`
	Timezone      string     `bun:"timezone,type:text,notnull,default:'UTC'" json:"timezone"`
	Enabled       bool       `bun:"enabled,type:bool,default:true" json:"enabled"`
	LastScanID    *uuid.UUID `bun:"last_scan_id,type:uuid" json:"last_scan_id"`
	LastScannedAt *time.Time `bun:"last_scanned_at,type:timestamptz" json:"last_scanned_at"`
	RegistryID    *uuid.UUID `bun:"registry_id,type:uuid" json:"registry_id"`
	TagIDs        []string   `bun:"tag_ids,type:jsonb" json:"tag_ids"`
	UserID        uuid.UUID  `bun:"user_id,type:uuid,notnull" json:"user_id"`
	CreatedAt     time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt     time.Time  `bun:"updated_at,type:timestamptz" json:"updated_at"`

	// Populated on join
	LastScan *Scan `bun:"-" json:"last_scan,omitempty"`
}
