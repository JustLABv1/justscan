package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

const (
	HelmRegistryProtocolOCI     = "oci"
	HelmRegistryProtocolHTTP    = "http"
	HelmRegistryAuthBasic       = "basic"
	HelmRegistryAuthAccessToken = "access_token"
	HelmRegistryAuthBearerToken = "bearer_token"
)

// HelmRegistryCredential is deliberately separate from Registry: it only
// authenticates Helm dependency downloads and can never be used for scans.
type HelmRegistryCredential struct {
	bun.BaseModel `bun:"table:helm_registry_credentials"`

	ID                   uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Name                 string     `bun:"name,type:text,notnull" json:"name"`
	URL                  string     `bun:"url,type:text,notnull" json:"url"`
	Protocol             string     `bun:"protocol,type:text,notnull" json:"protocol"`
	AuthType             string     `bun:"auth_type,type:text,notnull" json:"auth_type"`
	Username             string     `bun:"username,type:text,notnull,default:''" json:"username"`
	EncryptedSecret      string     `bun:"encrypted_secret,type:text,notnull,default:''" json:"-"`
	CredentialConfigured bool       `bun:"-" json:"credential_configured"`
	CreatedByID          uuid.UUID  `bun:"created_by_id,type:uuid,notnull" json:"created_by_id"`
	OwnerType            string     `bun:"owner_type,type:text,notnull,default:'user'" json:"owner_type"`
	OwnerUserID          *uuid.UUID `bun:"owner_user_id,type:uuid" json:"owner_user_id,omitempty"`
	OwnerOrgID           *uuid.UUID `bun:"owner_org_id,type:uuid" json:"owner_org_id,omitempty"`
	CreatedAt            time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt            time.Time  `bun:"updated_at,type:timestamptz" json:"updated_at"`
	HealthStatus         string     `bun:"health_status,type:text,notnull,default:'unknown'" json:"health_status"`
	HealthMessage        string     `bun:"health_message,type:text,notnull,default:''" json:"health_message"`
	LastHealthCheckAt    *time.Time `bun:"last_health_check_at,type:timestamptz" json:"last_health_check_at"`
}

type OrgHelmRegistryCredential struct {
	bun.BaseModel            `bun:"table:org_helm_registry_credentials"`
	OrgID                    uuid.UUID `bun:"org_id,type:uuid,notnull" json:"org_id"`
	HelmRegistryCredentialID uuid.UUID `bun:"helm_registry_credential_id,type:uuid,notnull" json:"helm_registry_credential_id"`
}
