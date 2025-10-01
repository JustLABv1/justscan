package models

import (
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Artikel struct {
	bun.BaseModel `bun:"table:artikel"`

	ID             uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Artikel        string    `bun:"artikel,type:text,notnull" json:"artikel"`
	Betriebsnummer string    `bun:"betriebsnummer,type:text,notnull" json:"betriebsnummer"`
	Kurzname       string    `bun:"kurzname,type:text" json:"kurzname"`
	Anzahl         int       `bun:"anzahl,type:int,notnull,default:0" json:"anzahl"`
}
