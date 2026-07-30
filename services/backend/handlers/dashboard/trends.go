package dashboard

import (
	"net/http"
	"time"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
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
		cutoff := trendCutoff(c.Query("range"), now)

		var rows []scanTrendRow
		query := db.NewSelect().
			TableExpr("scans").
			ColumnExpr("to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date").
			ColumnExpr("COUNT(*) AS total").
			ColumnExpr("SUM(CASE WHEN status = ? AND COALESCE(external_status, '') <> ? THEN 1 ELSE 0 END) AS completed", models.ScanStatusCompleted, models.ScanExternalStatusBlockedByXrayPolicy).
			ColumnExpr("SUM(CASE WHEN status = ? AND COALESCE(external_status, '') <> ? THEN 1 ELSE 0 END) AS failed", models.ScanStatusFailed, models.ScanExternalStatusBlockedByXrayPolicy).
			ColumnExpr("SUM(CASE WHEN external_status = ? THEN 1 ELSE 0 END) AS policy_blocked", models.ScanExternalStatusBlockedByXrayPolicy).
			ColumnExpr("SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS running", models.ScanStatusRunning).
			ColumnExpr("SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS pending", models.ScanStatusPending).
			ColumnExpr("SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS cancelled", models.ScanStatusCancelled).
			ColumnExpr("SUM(CASE WHEN status NOT IN (?) AND COALESCE(external_status, '') <> ? THEN 1 ELSE 0 END) AS other", bun.In([]string{models.ScanStatusCompleted, models.ScanStatusFailed, models.ScanStatusRunning, models.ScanStatusPending, models.ScanStatusCancelled}), models.ScanExternalStatusBlockedByXrayPolicy).
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
