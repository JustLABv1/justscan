package models

import (
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Artikel struct {
	bun.BaseModel `bun:"table:artikel"`

	ID            uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Artikelnummer string    `bun:"artikelnummer,type:text,notnull" json:"artikelnummer"`
	Kurzname      string    `bun:"kurzname,type:text" json:"kurzname"`
}
