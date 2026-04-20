package admins

import (
	"net/http"
	"strconv"
	"time"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

// GetAPIRequestLogs returns a paginated list of recorded API requests.
func GetAPIRequestLogs(c *gin.Context, db *bun.DB) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 500 {
		limit = 50
	}
	offset := (page - 1) * limit

	var entries []models.APIRequestLogWithUser

	q := db.NewSelect().
		TableExpr("api_request_logs r").
		ColumnExpr("r.*, COALESCE(u.username, '') AS username, COALESCE(u.email, '') AS email").
		Join("LEFT JOIN users u ON u.id::text = r.user_id").
		OrderExpr("r.created_at DESC")

	if method := c.Query("method"); method != "" {
		q = q.Where("r.method = ?", method)
	}
	if path := c.Query("path"); path != "" {
		q = q.Where("r.path ILIKE ?", "%"+path+"%")
	}
	if userFilter := c.Query("user"); userFilter != "" {
		pattern := "%" + userFilter + "%"
		q = q.WhereGroup(" AND ", func(sq *bun.SelectQuery) *bun.SelectQuery {
			return sq.
				Where("u.username ILIKE ?", pattern).
				WhereOr("u.email ILIKE ?", pattern).
				WhereOr("r.user_id ILIKE ?", pattern)
		})
	}
	if status := c.Query("status"); status != "" {
		switch status {
		case "2xx":
			q = q.Where("r.status_code >= 200 AND r.status_code < 300")
		case "4xx":
			q = q.Where("r.status_code >= 400 AND r.status_code < 500")
		case "5xx":
			q = q.Where("r.status_code >= 500")
		case "error":
			q = q.Where("r.status_code >= 400")
		default:
			if code, err := strconv.Atoi(status); err == nil {
				q = q.Where("r.status_code = ?", code)
			}
		}
	}
	if from := c.Query("from"); from != "" {
		if parsed, err := time.Parse(time.RFC3339, from); err == nil {
			q = q.Where("r.created_at >= ?", parsed)
		}
	}
	if to := c.Query("to"); to != "" {
		if parsed, err := time.Parse(time.RFC3339, to); err == nil {
			q = q.Where("r.created_at <= ?", parsed)
		}
	}

	total, err := q.Limit(limit).Offset(offset).ScanAndCount(c.Request.Context(), &entries)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load API request logs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": entries, "total": total})
}

// GetAPIUsageStats returns aggregated usage statistics for the admin insights view.
func GetAPIUsageStats(c *gin.Context, db *bun.DB) {
	ctx := c.Request.Context()

	// Build a reusable time-range WHERE clause.
	fromClause, toClause := "", ""
	var fromArgs, toArgs []any
	if from := c.Query("from"); from != "" {
		if parsed, err := time.Parse(time.RFC3339, from); err == nil {
			fromClause = "created_at >= ?"
			fromArgs = append(fromArgs, parsed)
		}
	}
	if to := c.Query("to"); to != "" {
		if parsed, err := time.Parse(time.RFC3339, to); err == nil {
			toClause = "created_at <= ?"
			toArgs = append(toArgs, parsed)
		}
	}

	applyRange := func(q *bun.SelectQuery) *bun.SelectQuery {
		if fromClause != "" {
			q = q.Where(fromClause, fromArgs...)
		}
		if toClause != "" {
			q = q.Where(toClause, toArgs...)
		}
		return q
	}

	// Total + error counts + avg + p95 duration.
	var summary struct {
		Total  int64   `bun:"total"`
		Errors int64   `bun:"errors"`
		Avg    float64 `bun:"avg_ms"`
		P95    float64 `bun:"p95_ms"`
	}
	summaryQ := applyRange(db.NewSelect().
		TableExpr("api_request_logs").
		ColumnExpr("COUNT(*) AS total").
		ColumnExpr("COUNT(*) FILTER (WHERE status_code >= 400) AS errors").
		ColumnExpr("COALESCE(AVG(duration_ms), 0) AS avg_ms").
		ColumnExpr("COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 0) AS p95_ms"))
	if err := summaryQ.Scan(ctx, &summary); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to compute usage stats"})
		return
	}

	// Top 10 endpoints by request count.
	var topEndpoints []models.EndpointStat
	endpointsQ := applyRange(db.NewSelect().
		TableExpr("api_request_logs").
		ColumnExpr("method, path, COUNT(*) AS count").
		GroupExpr("method, path").
		OrderExpr("count DESC").
		Limit(10))
	if err := endpointsQ.Scan(ctx, &topEndpoints); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to compute top endpoints"})
		return
	}

	// Top 10 users by request count.
	var topUsers []models.UserStat
	usersQ := applyRange(db.NewSelect().
		TableExpr("api_request_logs r").
		Join("LEFT JOIN users u ON u.id::text = r.user_id").
		ColumnExpr("r.user_id, COALESCE(u.username, r.user_id, 'anonymous') AS username, COUNT(*) AS count").
		GroupExpr("r.user_id, u.username").
		OrderExpr("count DESC").
		Limit(10))
	if err := usersQ.Scan(ctx, &topUsers); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to compute top users"})
		return
	}

	// Status code breakdown.
	var statusBreakdown []models.StatusBucket
	statusQ := applyRange(db.NewSelect().
		TableExpr("api_request_logs").
		ColumnExpr("status_code, COUNT(*) AS count").
		GroupExpr("status_code").
		OrderExpr("status_code"))
	if err := statusQ.Scan(ctx, &statusBreakdown); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to compute status breakdown"})
		return
	}

	stats := models.APIUsageStats{
		TotalRequests:   summary.Total,
		ErrorRequests:   summary.Errors,
		AvgDurationMs:   summary.Avg,
		P95DurationMs:   summary.P95,
		TopEndpoints:    topEndpoints,
		TopUsers:        topUsers,
		StatusBreakdown: statusBreakdown,
	}

	c.JSON(http.StatusOK, stats)
}
