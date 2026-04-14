package authz

import (
	"fmt"

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

func HasOrgRoleAtLeast(roles map[uuid.UUID]string, orgID uuid.UUID, minRole string) bool {
	role, ok := roles[orgID]
	if !ok {
		return false
	}
	return roleRank(role) >= roleRank(minRole)
}
