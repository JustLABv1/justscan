package models

import (
	"github.com/uptrace/bun"
)

type Kostenstellen struct {
	bun.BaseModel `bun:"table:kostenstellen"`

	Kostennummer int `bun:"kostennummer,pk,type:int,notnull" json:"kostennummer"`
}
