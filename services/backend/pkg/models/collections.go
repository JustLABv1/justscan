package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type ScanCollection struct {
	bun.BaseModel `bun:"table:scan_collections"`

	ID          uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Name        string     `bun:"name,type:text,notnull" json:"name"`
	OwnerType   string     `bun:"owner_type,type:text,notnull,default:'user'" json:"owner_type"`
	OwnerUserID *uuid.UUID `bun:"owner_user_id,type:uuid" json:"owner_user_id,omitempty"`
	OwnerOrgID  *uuid.UUID `bun:"owner_org_id,type:uuid" json:"owner_org_id,omitempty"`
	CreatedAt   time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt   time.Time  `bun:"updated_at,type:timestamptz" json:"updated_at"`
}

type ScanCollectionMembership struct {
	bun.BaseModel `bun:"table:scan_collection_memberships"`

	ScanID       uuid.UUID `bun:"scan_id,type:uuid,notnull" json:"scan_id"`
	CollectionID uuid.UUID `bun:"collection_id,type:uuid,notnull" json:"collection_id"`

	Scan       *Scan           `bun:"rel:belongs-to,join:scan_id=id"`
	Collection *ScanCollection `bun:"rel:belongs-to,join:collection_id=id"`
}
