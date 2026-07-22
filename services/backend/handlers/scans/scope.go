package scans

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func latestImageStatusWhereClause(raw string) (string, []interface{}) {
	statuses := strings.Split(raw, ",")
	clauses := make([]string, 0, len(statuses))
	args := make([]interface{}, 0, len(statuses)*2)

	for _, status := range statuses {
		status = strings.TrimSpace(status)
		if status == "" {
			continue
		}
		clauses = append(clauses, "(latest_status = ? OR latest_external_status = ?)")
		args = append(args, status, status)
	}
	if len(clauses) == 0 {
		return "1=1", nil
	}
	return "(" + strings.Join(clauses, " OR ") + ")", args
}

func scanOwnershipWhere(userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID, scanAlias string) (string, []interface{}) {
	if isAdmin {
		return "1=1", nil
	}

	idRef := qualifiedScanColumn(scanAlias, "id")
	clauses := []string{"user_id = ?", "owner_user_id = ?"}
	args := []interface{}{userID, userID}
	if len(accessibleOrgIDs) > 0 {
		ownerOrgPlaceholders := make([]string, len(accessibleOrgIDs))
		sharedOrgPlaceholders := make([]string, len(accessibleOrgIDs))
		for index, orgID := range accessibleOrgIDs {
			ownerOrgPlaceholders[index] = "?"
			sharedOrgPlaceholders[index] = "?"
			args = append(args, orgID)
		}
		for _, orgID := range accessibleOrgIDs {
			args = append(args, orgID)
		}
		clauses = append(clauses, "owner_org_id IN ("+strings.Join(ownerOrgPlaceholders, ",")+")")
		clauses = append(clauses, "EXISTS (SELECT 1 FROM org_scans os WHERE os.scan_id = "+idRef+" AND os.org_id IN ("+strings.Join(sharedOrgPlaceholders, ",")+"))")
	}
	return "(" + strings.Join(clauses, " OR ") + ")", args
}

func scanScopeWhere(c *gin.Context, userID uuid.UUID, scanAlias string) (string, []interface{}) {
	scope := c.Query("scope")
	if scope == "" {
		return "1=1", nil
	}
	if scope == "personal" {
		return "owner_user_id = ?", []interface{}{userID}
	}
	orgID, err := uuid.Parse(scope)
	if err != nil {
		return "1=1", nil
	}
	idRef := qualifiedScanColumn(scanAlias, "id")
	return "(owner_org_id = ? OR EXISTS (SELECT 1 FROM org_scans os2 WHERE os2.scan_id = " + idRef + " AND os2.org_id = ?))", []interface{}{orgID, orgID}
}

func qualifiedScanColumn(scanAlias, column string) string {
	alias := strings.TrimSpace(scanAlias)
	if alias == "" {
		alias = "scans"
	}
	return alias + "." + column
}
