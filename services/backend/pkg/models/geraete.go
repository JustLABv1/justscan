package models

import (
	"github.com/uptrace/bun"
)

type Geraete struct {
	bun.BaseModel `bun:"table:geraete"`

	Geraetenummer string `bun:"geraetenummer,pk,type:text,notnull" json:"geraetenummer"`
	Anlagegut     string `bun:"anlagegut,type:text,notnull" json:"anlagegut"`
}
