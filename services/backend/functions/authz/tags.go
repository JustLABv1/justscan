package authz

import (
	"context"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func CanReadTag(ctx context.Context, db *bun.DB, tag *models.Tag, userID uuid.UUID, isAdmin bool) bool {
	if tag == nil {
		return false
	}
	if isAdmin {
		return true
	}
	if tag.OwnerType == models.OwnerTypeSystem {
		return true
	}
	if tag.OwnerUserID != nil && *tag.OwnerUserID == userID {
		return true
	}
	if tag.OwnerOrgID == nil {
		return false
	}

	accessibleOrgIDs, err := ListAccessibleOrgIDs(ctx, db, userID, false)
	if err != nil || len(accessibleOrgIDs) == 0 {
		return false
	}
	for _, orgID := range accessibleOrgIDs {
		if orgID == *tag.OwnerOrgID {
			return true
		}
	}

	shared, err := db.NewSelect().
		TableExpr("org_tags").
		Where("tag_id = ?", tag.ID).
		Where("org_id IN (?)", bun.In(accessibleOrgIDs)).
		Exists(ctx)
	return err == nil && shared
}

func CanManageTag(ctx context.Context, db *bun.DB, tag *models.Tag, userID uuid.UUID, isAdmin bool) bool {
	if tag == nil {
		return false
	}
	if isAdmin {
		return true
	}
	if tag.OwnerType == models.OwnerTypeSystem {
		return false
	}
	if tag.OwnerUserID != nil && *tag.OwnerUserID == userID {
		return true
	}
	if tag.OwnerOrgID == nil {
		return false
	}
	roles, err := LoadUserOrgRoles(ctx, db, userID)
	if err != nil {
		return false
	}
	return HasOrgRoleAtLeast(roles, *tag.OwnerOrgID, models.OrgRoleEditor)
}
