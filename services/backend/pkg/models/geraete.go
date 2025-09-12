package models

import (
	"github.com/uptrace/bun"
)

type Geraete struct {
	bun.BaseModel `bun:"table:geraete"`

	Geraetenummer int    `bun:"geraetenummer,pk,type:int,notnull" json:"geraetenummer"`
	Kurzname      string `bun:"kurzname,type:text,notnull" json:"kurzname"`
	Anlagegut     string `bun:"anlagegut,type:text,notnull" json:"anlagegut"`
}
