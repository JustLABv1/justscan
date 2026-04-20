package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Registry struct {
	bun.BaseModel `bun:"table:registries"`

	ID                uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Name              string     `bun:"name,type:text,notnull" json:"name"`
	URL               string     `bun:"url,type:text,notnull" json:"url"`
	XrayURL           string     `bun:"xray_url,type:text,default:''" json:"xray_url"`
	XrayArtifactoryID string     `bun:"xray_artifactory_id,type:text,notnull,default:'default'" json:"xray_artifactory_id"`
	AuthType          string     `bun:"auth_type,type:text,notnull,default:'basic'" json:"auth_type"`
	ScanProvider      string     `bun:"scan_provider,type:text,notnull,default:'trivy'" json:"scan_provider"`
	Username          string     `bun:"username,type:text,default:''" json:"-"`
	Password          string     `bun:"password,type:text,default:''" json:"-"`
	CreatedByID       uuid.UUID  `bun:"created_by_id,type:uuid,notnull" json:"created_by_id"`
	OwnerType         string     `bun:"owner_type,type:text,notnull,default:'user'" json:"owner_type"`
	OwnerUserID       *uuid.UUID `bun:"owner_user_id,type:uuid" json:"owner_user_id,omitempty"`
	OwnerOrgID        *uuid.UUID `bun:"owner_org_id,type:uuid" json:"owner_org_id,omitempty"`
	CreatedAt         time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt         time.Time  `bun:"updated_at,type:timestamptz" json:"updated_at"`
	HealthStatus      string     `bun:"health_status,type:text,default:'unknown'" json:"health_status"`
	HealthMessage     string     `bun:"health_message,type:text,default:''" json:"health_message"`
	LastHealthCheckAt *time.Time `bun:"last_health_check_at,type:timestamptz" json:"last_health_check_at"`
	IsDefault         bool       `bun:"is_default,type:bool,notnull,default:false" json:"is_default"`
}

// Registry auth types
const (
	RegistryAuthNone   = "none"
	RegistryAuthBasic  = "basic"
	RegistryAuthToken  = "token"
	RegistryAuthAWSECR = "aws_ecr"
)
