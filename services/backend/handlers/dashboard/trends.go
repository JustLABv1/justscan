package dashboard

import (
	"net/http"
	"time"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type scanTrendRow struct {
	Date          string `bun:"date" json:"date"`
	Total         int64  `bun:"total" json:"total"`
	Completed     int64  `bun:"completed" json:"completed"`
	Failed        int64  `bun:"failed" json:"failed"`
	PolicyBlocked int64  `bun:"policy_blocked" json:"policy_blocked"`
	Running       int64  `bun:"running" json:"running"`
	Pending       int64  `bun:"pending" json:"pending"`
	Cancelled     int64  `bun:"cancelled" json:"cancelled"`
	OrgPolicyFail int64  `bun:"org_policy_failed" json:"org_policy_failed"`
	Other         int64  `bun:"other" json:"other"`
}

func trendCutoff(rangeName string, now time.Time) time.Time {
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	switch rangeName {
	case "6h":
		return now.Add(-6 * time.Hour)
	case "24h":
		return now.Add(-24 * time.Hour)
	case "7d":
		return startOfToday.AddDate(0, 0, -6)
	default:
		return startOfToday.AddDate(0, 0, -29)
	}
}

func usesHourlyTrendBuckets(rangeName string) bool {
	return rangeName == "6h" || rangeName == "24h"
}

func orgPolicyFailureCondition(scope string, isAdmin bool, accessibleOrgIDs []uuid.UUID) (string, []interface{}) {
	if !isAdmin && len(accessibleOrgIDs) == 0 {
		return "FALSE", nil
	}

	condition := "EXISTS (SELECT 1 FROM compliance_results AS cr WHERE cr.scan_id = scan.id AND cr.status = 'fail'"
	args := make([]interface{}, 0, 2)
	if !isAdmin {
		condition += " AND cr.org_id IN (?)"
		args = append(args, bun.In(accessibleOrgIDs))
	}
	if orgID, scoped := scopedOrgID(scope); scoped {
		condition += " AND cr.org_id = ?"
		args = append(args, orgID)
	}

	return condition + ")", args
}

// GetTrends returns daily scan outcome counts. The optional range query accepts
// 6h, 24h, 7d, and 30d; 30d is the default.
func GetTrends(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}
		now := time.Now().UTC()
		rangeName := c.Query("range")
		cutoff := trendCutoff(rangeName, now)
		bucketExpression := "to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date"
		if usesHourlyTrendBuckets(rangeName) {
			bucketExpression = "to_char(date_trunc('hour', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:00:00\"Z\"') AS date"
		}
		orgPolicyFailure, orgPolicyFailureArgs := orgPolicyFailureCondition(
			c.Query("scope"),
			isAdmin,
			accessibleOrgIDs,
		)
		completedArgs := append([]interface{}{models.ScanStatusCompleted, models.ScanExternalStatusBlockedByXrayPolicy}, orgPolicyFailureArgs...)
		failedArgs := append([]interface{}{models.ScanStatusFailed, models.ScanExternalStatusBlockedByXrayPolicy}, orgPolicyFailureArgs...)
		policyBlockedArgs := append([]interface{}{models.ScanExternalStatusBlockedByXrayPolicy}, orgPolicyFailureArgs...)
		runningArgs := append([]interface{}{models.ScanStatusRunning}, orgPolicyFailureArgs...)
		pendingArgs := append([]interface{}{models.ScanStatusPending}, orgPolicyFailureArgs...)
		cancelledArgs := append([]interface{}{models.ScanStatusCancelled}, orgPolicyFailureArgs...)
		otherArgs := append([]interface{}{bun.In([]string{models.ScanStatusCompleted, models.ScanStatusFailed, models.ScanStatusRunning, models.ScanStatusPending, models.ScanStatusCancelled}), models.ScanExternalStatusBlockedByXrayPolicy}, orgPolicyFailureArgs...)
		orgPolicyFailedColumn := "SUM(CASE WHEN " + orgPolicyFailure + " THEN 1 ELSE 0 END) AS org_policy_failed"

		var rows []scanTrendRow
		query := db.NewSelect().
			TableExpr("scans AS scan").
			ColumnExpr(bucketExpression).
			ColumnExpr("COUNT(*) AS total").
			ColumnExpr("SUM(CASE WHEN status = ? AND COALESCE(external_status, '') <> ? AND NOT ("+orgPolicyFailure+") THEN 1 ELSE 0 END) AS completed", completedArgs...).
			ColumnExpr("SUM(CASE WHEN status = ? AND COALESCE(external_status, '') <> ? AND NOT ("+orgPolicyFailure+") THEN 1 ELSE 0 END) AS failed", failedArgs...).
			ColumnExpr("SUM(CASE WHEN external_status = ? AND NOT ("+orgPolicyFailure+") THEN 1 ELSE 0 END) AS policy_blocked", policyBlockedArgs...).
			ColumnExpr("SUM(CASE WHEN status = ? AND NOT ("+orgPolicyFailure+") THEN 1 ELSE 0 END) AS running", runningArgs...).
			ColumnExpr("SUM(CASE WHEN status = ? AND NOT ("+orgPolicyFailure+") THEN 1 ELSE 0 END) AS pending", pendingArgs...).
			ColumnExpr("SUM(CASE WHEN status = ? AND NOT ("+orgPolicyFailure+") THEN 1 ELSE 0 END) AS cancelled", cancelledArgs...)
		if len(orgPolicyFailureArgs) == 0 {
			query = query.ColumnExpr(orgPolicyFailedColumn)
		} else {
			query = query.ColumnExpr(orgPolicyFailedColumn, orgPolicyFailureArgs...)
		}
		query = query.
			ColumnExpr("SUM(CASE WHEN status NOT IN (?) AND COALESCE(external_status, '') <> ? AND NOT ("+orgPolicyFailure+") THEN 1 ELSE 0 END) AS other", otherArgs...).
			Where("created_at >= ?", cutoff).
			GroupExpr("date").
			OrderExpr("date ASC")
		query = authz.ApplyOwnershipVisibility(query, "", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
		query = authz.ApplyWorkspaceScope(c, query, "", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
		query.Scan(ctx, &rows) //nolint:errcheck

		if rows == nil {
			rows = []scanTrendRow{}
		}

		c.JSON(http.StatusOK, gin.H{"data": rows})
	}
}
