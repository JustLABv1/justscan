package models

import (
	"time"

	"github.com/uptrace/bun"
)

type SystemSetting struct {
	bun.BaseModel `bun:"table:system_settings"`

	Key       string    `bun:"key,pk" json:"key"`
	Value     string    `bun:"value" json:"value"`
	UpdatedAt time.Time `bun:"updated_at" json:"updated_at"`
}
