package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Tag struct {
	bun.BaseModel `bun:"table:tags"`

	ID          uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Name        string     `bun:"name,type:text,notnull,unique" json:"name"`
	Color       string     `bun:"color,type:text,default:'#6366f1'" json:"color"`
	OwnerType   string     `bun:"owner_type,type:text,notnull,default:'system'" json:"owner_type"`
	OwnerUserID *uuid.UUID `bun:"owner_user_id,type:uuid" json:"owner_user_id,omitempty"`
	OwnerOrgID  *uuid.UUID `bun:"owner_org_id,type:uuid" json:"owner_org_id,omitempty"`
	CreatedAt   time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
}

// ScanTag is the many-to-many join table between scans and tags
type ScanTag struct {
	bun.BaseModel `bun:"table:scan_tags"`

	ScanID uuid.UUID `bun:"scan_id,type:uuid,notnull" json:"scan_id"`
	TagID  uuid.UUID `bun:"tag_id,type:uuid,notnull" json:"tag_id"`

	Scan *Scan `bun:"rel:belongs-to,join:scan_id=id"`
	Tag  *Tag  `bun:"rel:belongs-to,join:tag_id=id"`
}
