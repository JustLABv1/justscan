package models

import (
	"time"

	"github.com/lib/pq"
	"github.com/uptrace/bun"
)

// OIDCProvider represents a configured OIDC identity provider.
type OIDCProvider struct {
	bun.BaseModel `bun:"table:oidc_providers"`

	Name         string         `bun:"name,pk,type:text" json:"name"`
	DisplayName  string         `bun:"display_name,type:text,notnull" json:"display_name"`
	ButtonColor  string         `bun:"button_color,type:text,notnull,default:''" json:"button_color"`
	IssuerURL    string         `bun:"issuer_url,type:text,notnull" json:"issuer_url"`
	ClientID     string         `bun:"client_id,type:text,notnull" json:"client_id"`
	ClientSecret string         `bun:"client_secret,type:text,notnull,default:''" json:"client_secret,omitempty"`
	RedirectURI  string         `bun:"redirect_uri,type:text,notnull,default:''" json:"redirect_uri"`
	Scopes       pq.StringArray `bun:"scopes,type:text[],notnull,default:'{}'" json:"scopes"`
	AdminGroups  pq.StringArray `bun:"admin_groups,type:text[],notnull,default:'{}'" json:"admin_groups"`
	AdminRoles   pq.StringArray `bun:"admin_roles,type:text[],notnull,default:'{}'" json:"admin_roles"`
	GroupsClaim  string         `bun:"groups_claim,type:text,notnull,default:'groups'" json:"groups_claim"`
	RolesClaim   string         `bun:"roles_claim,type:text,notnull,default:'roles'" json:"roles_claim"`
	Enabled      bool           `bun:"enabled,type:bool,notnull,default:true" json:"enabled"`
	SortOrder    int            `bun:"sort_order,type:int,notnull,default:0" json:"sort_order"`
	CreatedAt    time.Time      `bun:"created_at,type:timestamptz,notnull,default:now()" json:"created_at"`
	UpdatedAt    time.Time      `bun:"updated_at,type:timestamptz,notnull,default:now()" json:"updated_at"`
}

// OIDCProviderPublic is the subset returned to unauthenticated clients (login page).
type OIDCProviderPublic struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	ButtonColor string `json:"button_color"`
}

// UserOIDCLink maps a user account to an OIDC provider identity.
type UserOIDCLink struct {
	bun.BaseModel `bun:"table:user_oidc_links"`

	UserID       string    `bun:"user_id,type:uuid,notnull" json:"user_id"`
	ProviderName string    `bun:"provider_name,type:text,notnull" json:"provider_name"`
	OIDCSubject  string    `bun:"oidc_subject,type:text,notnull" json:"oidc_subject"`
	LinkedAt     time.Time `bun:"linked_at,type:timestamptz,notnull,default:now()" json:"linked_at"`
}

// OIDCGroupOrgMapping maps an OIDC group to an org with a role.
type OIDCGroupOrgMapping struct {
	bun.BaseModel `bun:"table:oidc_group_org_mappings"`

	ID             string    `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ProviderName   string    `bun:"provider_name,type:text,notnull" json:"provider_name"`
	OIDCGroup      string    `bun:"oidc_group,type:text,notnull" json:"oidc_group"`
	OrgID          string    `bun:"org_id,type:uuid,notnull" json:"org_id"`
	Role           string    `bun:"role,type:text,notnull,default:'viewer'" json:"role"`
	AutoCreateOrg  bool      `bun:"auto_create_org,type:bool,notnull,default:false" json:"auto_create_org"`
	RemoveOnUnsync bool      `bun:"remove_on_unsync,type:bool,notnull,default:true" json:"remove_on_unsync"`
	CreatedAt      time.Time `bun:"created_at,type:timestamptz,notnull,default:now()" json:"created_at"`

	// Computed fields (not in DB)
	OrgName string `bun:"-" json:"org_name,omitempty"`
}
