package authz

import (
	"context"
	"database/sql"
	"net/http"
	"sort"

	baseauth "justscan-backend/functions/auth"
	"justscan-backend/middlewares"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ResolveRequestUser(c *gin.Context, db *bun.DB) (uuid.UUID, bool, error) {
	userIDValue, hasUserID := c.Get(middlewares.AuthContextUserIDKey)
	isAdminValue, hasIsAdmin := c.Get(middlewares.AuthContextIsAdminKey)

	userID, userIDOK := userIDValue.(uuid.UUID)
	isAdmin, isAdminOK := isAdminValue.(bool)
	if hasUserID && hasIsAdmin && userIDOK && isAdminOK {
		return userID, isAdmin, nil
	}

	return baseauth.ResolveUserAccess(c.GetHeader("Authorization"), db)
}

func RequireRequestUser(c *gin.Context, db *bun.DB) (uuid.UUID, bool, bool) {
	userID, isAdmin, err := ResolveRequestUser(c, db)
	if err != nil {
		writeUserAccessError(c, err)
		return uuid.Nil, false, false
	}

	return userID, isAdmin, true
}

func RequireAdmin(c *gin.Context, db *bun.DB) (uuid.UUID, bool) {
	userID, isAdmin, ok := RequireRequestUser(c, db)
	if !ok {
		return uuid.Nil, false
	}
	if !isAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return uuid.Nil, false
	}

	return userID, true
}

func LoadAuthorizedOrg(c *gin.Context, db *bun.DB, orgID uuid.UUID) (*models.Org, uuid.UUID, bool, bool) {
	org, _, userID, isAdmin, ok := RequireOrgRole(c, db, orgID, models.OrgRoleMember)
	return org, userID, isAdmin, ok
}

func RequireOrgRole(c *gin.Context, db *bun.DB, orgID uuid.UUID, minRole string) (*models.Org, *models.OrgMember, uuid.UUID, bool, bool) {
	userID, isAdmin, ok := RequireRequestUser(c, db)
	if !ok {
		return nil, nil, uuid.Nil, false, false
	}

	org := &models.Org{}
	if err := db.NewSelect().Model(org).Where("id = ?", orgID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "organization not found"})
		return nil, nil, uuid.Nil, false, false
	}
	if isAdmin {
		return org, nil, userID, true, true
	}

	membership, err := LoadOrgMembership(c.Request.Context(), db, orgID, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "organization not found"})
		return nil, nil, uuid.Nil, false, false
	}
	org.CurrentUserRole = membership.Role

	if roleRank(membership.Role) < roleRank(minRole) {
		c.JSON(http.StatusForbidden, gin.H{"error": "insufficient organization permissions"})
		return nil, nil, uuid.Nil, false, false
	}

	return org, membership, userID, isAdmin, true
}

func LoadAuthorizedRegistry(c *gin.Context, db *bun.DB, registryID uuid.UUID) (*models.Registry, uuid.UUID, bool, bool) {
	userID, isAdmin, ok := RequireRequestUser(c, db)
	if !ok {
		return nil, uuid.Nil, false, false
	}

	registry := &models.Registry{}
	if err := db.NewSelect().Model(registry).Where("id = ?", registryID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "registry not found"})
		return nil, uuid.Nil, false, false
	}

	if isAdmin {
		return registry, userID, isAdmin, true
	}
	if registry.CreatedByID == userID {
		return registry, userID, isAdmin, true
	}
	if registry.OwnerUserID != nil && *registry.OwnerUserID == userID {
		return registry, userID, isAdmin, true
	}
	if registry.OwnerOrgID != nil {
		roles, err := LoadUserOrgRoles(c.Request.Context(), db, userID)
		if err == nil && HasOrgRoleAtLeast(roles, *registry.OwnerOrgID, models.OrgRoleAdmin) {
			return registry, userID, isAdmin, true
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "registry not found"})
	return nil, uuid.Nil, false, false

}

func LoadOrgMembership(ctx context.Context, db *bun.DB, orgID, userID uuid.UUID) (*models.OrgMember, error) {
	membership := &models.OrgMember{}
	if err := db.NewSelect().Model(membership).
		Where("org_id = ? AND user_id = ?", orgID, userID).
		Scan(ctx); err == nil {
		return membership, nil
	}

	org := &models.Org{}
	if err := db.NewSelect().Model(org).
		Column("created_by_id").
		Where("id = ?", orgID).
		Scan(ctx); err != nil {
		return nil, err
	}
	if org.CreatedByID == userID {
		return &models.OrgMember{
			OrgID:  orgID,
			UserID: userID,
			Role:   models.OrgRoleOwner,
		}, nil
	}

	return nil, sql.ErrNoRows
}

func LoadUserOrgRoles(ctx context.Context, db *bun.DB, userID uuid.UUID) (map[uuid.UUID]string, error) {
	var memberships []models.OrgMember
	if err := db.NewSelect().Model(&memberships).
		Column("org_id", "role").
		Where("user_id = ?", userID).
		Scan(ctx); err != nil {
		return nil, err
	}

	roles := make(map[uuid.UUID]string, len(memberships))
	for _, membership := range memberships {
		roles[membership.OrgID] = membership.Role
	}

	return roles, nil
}

func ListAccessibleOrgIDs(ctx context.Context, db *bun.DB, userID uuid.UUID, isAdmin bool) ([]uuid.UUID, error) {
	if isAdmin {
		return nil, nil
	}

	type row struct {
		ID uuid.UUID `bun:"id"`
	}

	var rows []row
	if err := db.NewRaw(`
		SELECT DISTINCT o.id
		FROM orgs o
		LEFT JOIN org_members om
		  ON om.org_id = o.id AND om.user_id = ?
		WHERE o.created_by_id = ? OR om.user_id = ?
	`, userID, userID, userID).Scan(ctx, &rows); err != nil {
		return nil, err
	}

	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	sort.Slice(ids, func(i, j int) bool {
		return ids[i].String() < ids[j].String()
	})

	return ids, nil
}

func roleRank(role string) int {
	switch role {
	case models.OrgRoleOwner:
		return 3
	case models.OrgRoleAdmin:
		return 2
	case models.OrgRoleMember:
		return 1
	default:
		return 0
	}
}

func writeUserAccessError(c *gin.Context, err error) {
	if err != nil && err.Error() == "user token required" {
		c.JSON(http.StatusForbidden, gin.H{"error": "user token required"})
		return
	}

	c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
}
