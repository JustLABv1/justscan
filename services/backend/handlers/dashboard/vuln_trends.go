package dashboard

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

type vulnTrendRow struct {
	Date     string `bun:"date"     json:"date"`
	Critical int64  `bun:"critical" json:"critical"`
	High     int64  `bun:"high"     json:"high"`
	Medium   int64  `bun:"medium"   json:"medium"`
	Low      int64  `bun:"low"      json:"low"`
	Unknown  int64  `bun:"unknown"  json:"unknown"`
}

// GetVulnTrends returns daily vulnerability counts (by severity) from completed scans.
// Query param: days (1–365, default 30)
func GetVulnTrends(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()

		days := 30
		if d := c.Query("days"); d != "" {
			if n, err := strconv.Atoi(d); err == nil && n > 0 && n <= 365 {
				days = n
			}
		}
		cutoff := time.Now().UTC().AddDate(0, 0, -days)

		var rows []vulnTrendRow
		db.NewSelect().
			TableExpr("scans").
			ColumnExpr("to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date").
			ColumnExpr("ROUND(COALESCE(SUM(critical_count), 0)::numeric / COUNT(*))::bigint AS critical").
			ColumnExpr("ROUND(COALESCE(SUM(high_count), 0)::numeric / COUNT(*))::bigint AS high").
			ColumnExpr("ROUND(COALESCE(SUM(medium_count), 0)::numeric / COUNT(*))::bigint AS medium").
			ColumnExpr("ROUND(COALESCE(SUM(low_count), 0)::numeric / COUNT(*))::bigint AS low").
			ColumnExpr("ROUND(COALESCE(SUM(unknown_count), 0)::numeric / COUNT(*))::bigint AS unknown").
			Where("status = 'completed'").
			Where("created_at >= ?", cutoff).
			GroupExpr("date").
			OrderExpr("date ASC").
			Scan(ctx, &rows) //nolint:errcheck

		if rows == nil {
			rows = []vulnTrendRow{}
		}

		c.JSON(http.StatusOK, gin.H{"data": rows})
	}
}
