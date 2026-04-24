package authz

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ApplyOwnershipVisibility(query *bun.SelectQuery, alias, legacyUserColumn, ownerUserColumn, ownerOrgColumn, shareTable, shareResourceColumn string, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID) *bun.SelectQuery {
	if isAdmin {
		return query
	}

	qualify := func(column string) string {
		if alias == "" {
			return column
		}
		return alias + "." + column
	}

	return query.WhereGroup(" AND ", func(q *bun.SelectQuery) *bun.SelectQuery {
		hasCondition := false
		addWhere := func(condition string, args ...interface{}) {
			if !hasCondition {
				q = q.Where(condition, args...)
				hasCondition = true
				return
			}
			q = q.WhereOr(condition, args...)
		}

		if legacyUserColumn != "" {
			addWhere(fmt.Sprintf("%s = ?", qualify(legacyUserColumn)), userID)
		}
		if ownerUserColumn != "" {
			addWhere(fmt.Sprintf("%s = ?", qualify(ownerUserColumn)), userID)
		}
		if ownerOrgColumn != "" && len(accessibleOrgIDs) > 0 {
			addWhere(fmt.Sprintf("%s IN (?)", qualify(ownerOrgColumn)), bun.In(accessibleOrgIDs))
		}
		if shareTable != "" && shareResourceColumn != "" && len(accessibleOrgIDs) > 0 {
			addWhere(fmt.Sprintf("EXISTS (SELECT 1 FROM %s shared WHERE shared.%s = %s AND shared.org_id IN (?))", shareTable, shareResourceColumn, qualify("id")), bun.In(accessibleOrgIDs))
		}
		if !hasCondition {
			q = q.Where("1 = 0")
		}

		return q
	})
}

// ApplyWorkspaceScope filters a query to only include resources matching the
// selected workspace scope. The scope value comes from the "scope" query
// parameter:
//   - ""          → no additional filter (show everything the user can see)
//   - "personal"  → only user-owned resources
//   - org UUID    → only resources owned by or shared with that org
//
// alias, ownerUserColumn, ownerOrgColumn and shareTable/shareResourceColumn
// mirror the same columns used in ApplyOwnershipVisibility.
func ApplyWorkspaceScope(c *gin.Context, query *bun.SelectQuery, alias, ownerUserColumn, ownerOrgColumn, shareTable, shareResourceColumn string, userID uuid.UUID) *bun.SelectQuery {
	scope := c.Query("scope")
	if scope == "" {
		return query
	}

	qualify := func(column string) string {
		if alias == "" {
			return column
		}
		return alias + "." + column
	}

	if scope == "personal" {
		return query.Where(fmt.Sprintf("%s = ?", qualify(ownerUserColumn)), userID)
	}

	orgID, err := uuid.Parse(scope)
	if err != nil {
		return query
	}

	return query.WhereGroup(" AND ", func(q *bun.SelectQuery) *bun.SelectQuery {
		q = q.Where(fmt.Sprintf("%s = ?", qualify(ownerOrgColumn)), orgID)
		if shareTable != "" && shareResourceColumn != "" {
			q = q.WhereOr(fmt.Sprintf("EXISTS (SELECT 1 FROM %s shared WHERE shared.%s = %s AND shared.org_id = ?)", shareTable, shareResourceColumn, qualify("id")), orgID)
		}
		return q
	})
}

func HasOrgRoleAtLeast(roles map[uuid.UUID]string, orgID uuid.UUID, minRole string) bool {
	role, ok := roles[orgID]
	if !ok {
		return false
	}
	return roleRank(role) >= roleRank(minRole)
}
