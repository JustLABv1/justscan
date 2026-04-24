package models

import "github.com/google/uuid"

const (
	OwnerTypeUser   = "user"
	OwnerTypeOrg    = "org"
	OwnerTypeSystem = "system"
)

type ResourceOwnership struct {
	OwnerType   string     `json:"owner_type"`
	OwnerUserID *uuid.UUID `json:"owner_user_id,omitempty"`
	OwnerOrgID  *uuid.UUID `json:"owner_org_id,omitempty"`
}
