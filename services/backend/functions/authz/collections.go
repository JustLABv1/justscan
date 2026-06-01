package authz

import (
	"context"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func CanReadCollection(ctx context.Context, db *bun.DB, collection *models.ScanCollection, userID uuid.UUID, isAdmin bool) bool {
	if collection == nil {
		return false
	}
	if isAdmin {
		return true
	}
	if collection.OwnerUserID != nil && *collection.OwnerUserID == userID {
		return true
	}
	if collection.OwnerOrgID == nil {
		return false
	}

	accessibleOrgIDs, err := ListAccessibleOrgIDs(ctx, db, userID, false)
	if err != nil || len(accessibleOrgIDs) == 0 {
		return false
	}
	for _, orgID := range accessibleOrgIDs {
		if orgID == *collection.OwnerOrgID {
			return true
		}
	}

	return false
}

func CanManageCollection(ctx context.Context, db *bun.DB, collection *models.ScanCollection, userID uuid.UUID, isAdmin bool) bool {
	if collection == nil {
		return false
	}
	if isAdmin {
		return true
	}
	if collection.OwnerUserID != nil && *collection.OwnerUserID == userID {
		return true
	}
	if collection.OwnerOrgID == nil {
		return false
	}

	roles, err := LoadUserOrgRoles(ctx, db, userID)
	if err != nil {
		return false
	}
	return HasOrgRoleAtLeast(roles, *collection.OwnerOrgID, models.OrgRoleEditor)
}
