package models

import (
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Bestellungen struct {
	bun.BaseModel `bun:"table:bestellungen"`

	ID          uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Artikel     []Artikel `bun:"type:jsonb,default:jsonb('[]')" json:"artikel"`
	Status      string    `bun:"type:text,notnull,default:'offen'" json:"status"`
	BestelltVon string    `bun:"type:text,notnull" json:"bestellt_von"`
	BestelltAm  string    `bun:"type:text,default:now()" json:"bestellt_am"`
}
