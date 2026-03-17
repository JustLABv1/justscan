package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Registry struct {
	bun.BaseModel `bun:"table:registries"`

	ID          uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Name        string    `bun:"name,type:text,notnull" json:"name"`
	URL         string    `bun:"url,type:text,notnull" json:"url"`
	AuthType    string    `bun:"auth_type,type:text,notnull,default:'basic'" json:"auth_type"`
	Username    string    `bun:"username,type:text,default:''" json:"-"`
	Password    string    `bun:"password,type:text,default:''" json:"-"`
	CreatedByID uuid.UUID `bun:"created_by_id,type:uuid,notnull" json:"created_by_id"`
	CreatedAt   time.Time `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt   time.Time `bun:"updated_at,type:timestamptz" json:"updated_at"`
}

// Registry auth types
const (
	RegistryAuthBasic  = "basic"
	RegistryAuthToken  = "token"
	RegistryAuthAWSECR = "aws_ecr"
)
