package models

import (
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Geraete struct {
	bun.BaseModel `bun:"table:geraete"`

	ID             uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Betriebsnummer string    `bun:"betriebsnummer,type:text,notnull" json:"betriebsnummer"`
	Gerätenummer   string    `bun:"gerätenummer,type:text,notnull" json:"gerätenummer"`
}
