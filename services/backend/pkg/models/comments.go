package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Comment struct {
	bun.BaseModel `bun:"table:comments"`

	ID              uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	VulnerabilityID uuid.UUID `bun:"vulnerability_id,type:uuid,notnull" json:"vulnerability_id"`
	ScanID          uuid.UUID `bun:"scan_id,type:uuid,notnull" json:"scan_id"`
	UserID          uuid.UUID `bun:"user_id,type:uuid,notnull" json:"user_id"`
	Content         string    `bun:"content,type:text,notnull" json:"content"`
	CreatedAt       time.Time `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt       time.Time `bun:"updated_at,type:timestamptz" json:"updated_at"`

	// Populated on join
	Username string `bun:"-" json:"username,omitempty"`
}
