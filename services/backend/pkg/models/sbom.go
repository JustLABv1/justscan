package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type SBOMComponent struct {
	bun.BaseModel `bun:"table:sbom_components"`

	ID         uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ScanID     uuid.UUID `bun:"scan_id,type:uuid,notnull" json:"scan_id"`
	Name       string    `bun:"name,type:text,notnull" json:"name"`
	Version    string    `bun:"version,type:text,default:''" json:"version"`
	Type       string    `bun:"type,type:text,default:'library'" json:"type"`
	PackageURL string    `bun:"package_url,type:text,default:''" json:"package_url"`
	License    string    `bun:"license,type:text,default:''" json:"license"`
	Supplier   string    `bun:"supplier,type:text,default:''" json:"supplier"`
	CreatedAt  time.Time `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
}
