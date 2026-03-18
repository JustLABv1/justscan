package dashboard

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

type scanTrendRow struct {
	Date      string `bun:"date" json:"date"`
	Total     int64  `bun:"total" json:"total"`
	Completed int64  `bun:"completed" json:"completed"`
	Failed    int64  `bun:"failed" json:"failed"`
}

// GetTrends returns daily scan counts (total, completed, failed) for the last 30 days.
func GetTrends(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()

		var rows []scanTrendRow
		db.NewSelect().
			TableExpr("scans").
			ColumnExpr("to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date").
			ColumnExpr("COUNT(*) AS total").
			ColumnExpr("SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed").
			ColumnExpr("SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed").
			Where("created_at >= NOW() - INTERVAL '30 days'").
			GroupExpr("date").
			OrderExpr("date ASC").
			Scan(ctx, &rows) //nolint:errcheck

		if rows == nil {
			rows = []scanTrendRow{}
		}

		c.JSON(http.StatusOK, gin.H{"data": rows})
	}
}
