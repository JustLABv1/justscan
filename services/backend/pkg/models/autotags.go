package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type AutoTagRule struct {
	bun.BaseModel `bun:"table:auto_tag_rules"`

	ID          uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Pattern     string    `bun:"pattern,type:text,notnull" json:"pattern"`
	TagID       uuid.UUID `bun:"tag_id,type:uuid,notnull" json:"tag_id"`
	CreatedByID uuid.UUID `bun:"created_by_id,type:uuid,notnull" json:"created_by_id"`
	CreatedAt   time.Time `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt   time.Time `bun:"updated_at,type:timestamptz" json:"updated_at"`

	Tag *Tag `bun:"rel:belongs-to,join:tag_id=id" json:"tag,omitempty"`
}
