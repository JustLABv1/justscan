package models

import (
	"github.com/uptrace/bun"
)

type Artikel struct {
	bun.BaseModel `bun:"table:artikel"`

	Artikelnummer int    `bun:"artikelnummer,pk,type:int,notnull" json:"artikelnummer"`
	Kurzname      string `bun:"kurzname,type:text,notnull" json:"kurzname"`
}
