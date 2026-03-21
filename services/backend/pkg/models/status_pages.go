package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

const (
	StatusPageVisibilityPrivate       = "private"
	StatusPageVisibilityPublic        = "public"
	StatusPageVisibilityAuthenticated = "authenticated"
)

type StatusPage struct {
	bun.BaseModel `bun:"table:status_pages"`

	ID              uuid.UUID          `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Name            string             `bun:"name,type:text,notnull" json:"name"`
	Slug            string             `bun:"slug,type:text,notnull,unique" json:"slug"`
	Description     string             `bun:"description,type:text,default:''" json:"description"`
	Visibility      string             `bun:"visibility,type:varchar(20),notnull,default:'private'" json:"visibility"`
	IncludeAllTags  bool               `bun:"include_all_tags,type:boolean,notnull,default:false" json:"include_all_tags"`
	StaleAfterHours int                `bun:"stale_after_hours,type:int,notnull,default:72" json:"stale_after_hours"`
	OwnerUserID     uuid.UUID          `bun:"owner_user_id,type:uuid,notnull" json:"owner_user_id"`
	CreatedAt       time.Time          `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt       time.Time          `bun:"updated_at,type:timestamptz" json:"updated_at"`
	Targets         []StatusPageTarget `bun:"rel:has-many,join:id=page_id" json:"targets,omitempty"`
	Updates         []StatusPageUpdate `bun:"rel:has-many,join:id=page_id" json:"updates,omitempty"`
}

type StatusPageTarget struct {
	bun.BaseModel `bun:"table:status_page_targets"`

	ID           uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	PageID       uuid.UUID `bun:"page_id,type:uuid,notnull" json:"page_id"`
	ImageName    string    `bun:"image_name,type:text,notnull" json:"image_name"`
	ImageTag     string    `bun:"image_tag,type:text,notnull" json:"image_tag"`
	DisplayOrder int       `bun:"display_order,type:int,notnull,default:0" json:"display_order"`
	CreatedAt    time.Time `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
}

type StatusPageUpdate struct {
	bun.BaseModel `bun:"table:status_page_updates"`

	ID              uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	PageID          uuid.UUID  `bun:"page_id,type:uuid,notnull" json:"page_id"`
	Title           string     `bun:"title,type:text,notnull" json:"title"`
	Body            string     `bun:"body,type:text,default:''" json:"body"`
	Level           string     `bun:"level,type:varchar(20),notnull,default:'info'" json:"level"`
	ActiveFrom      *time.Time `bun:"active_from,type:timestamptz" json:"active_from,omitempty"`
	ActiveUntil     *time.Time `bun:"active_until,type:timestamptz" json:"active_until,omitempty"`
	CreatedByUserID uuid.UUID  `bun:"created_by_user_id,type:uuid,notnull" json:"created_by_user_id"`
	CreatedAt       time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt       time.Time  `bun:"updated_at,type:timestamptz" json:"updated_at"`
}
