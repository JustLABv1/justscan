package models

import (
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Lieferschein struct {
	bun.BaseModel `bun:"table:lieferscheine"`

	ID              uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Abholer         string    `bun:"type:text,notnull" json:"abholer"`
	KostenstelleVon string    `bun:"type:text,notnull" json:"kostenstelle_von"`
	KostenstelleZu  string    `bun:"type:text,notnull" json:"kostenstelle_zu"`
	Artikel         []Artikel `bun:"type:jsonb,default:jsonb('[]')" json:"artikel"`
}
