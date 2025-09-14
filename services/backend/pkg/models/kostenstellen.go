package models

import (
	"github.com/uptrace/bun"
)

type Kostenstellen struct {
	bun.BaseModel `bun:"table:kostenstellen"`

	Kostenstellenummer string `bun:"kostenstellenummer,pk,type:text,notnull" json:"kostenstellenummer"`
	Bezeichnung        string `bun:"bezeichnung,type:text,default:''" json:"bezeichnung"`
}
