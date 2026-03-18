package scans

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

type trendRow struct {
	Date      string `bun:"date" json:"date"`
	Critical  int64  `bun:"critical" json:"critical"`
	High      int64  `bun:"high" json:"high"`
	Medium    int64  `bun:"medium" json:"medium"`
	Low       int64  `bun:"low" json:"low"`
	Unknown   int64  `bun:"unknown" json:"unknown"`
	ScanCount int64  `bun:"scan_count" json:"scan_count"`
}

// GetTrends returns daily aggregated vulnerability counts for completed scans.
func GetTrends(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
		if days <= 0 {
			days = 30
		}

		imageName := c.Query("image_name")
		imageTag := c.Query("image_tag")

		q := db.NewSelect().
			TableExpr("scans").
			ColumnExpr("to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date").
			ColumnExpr("COALESCE(SUM(critical_count), 0) AS critical").
			ColumnExpr("COALESCE(SUM(high_count), 0) AS high").
			ColumnExpr("COALESCE(SUM(medium_count), 0) AS medium").
			ColumnExpr("COALESCE(SUM(low_count), 0) AS low").
			ColumnExpr("COALESCE(SUM(unknown_count), 0) AS unknown").
			ColumnExpr("COUNT(*) AS scan_count").
			Where("status = 'completed'").
			Where("completed_at >= NOW() - (? * INTERVAL '1 day')", days).
			GroupExpr("date").
			OrderExpr("date ASC")

		if imageName != "" {
			q = q.Where("image_name ILIKE ?", "%"+imageName+"%")
		}
		if imageTag != "" {
			q = q.Where("image_tag = ?", imageTag)
		}

		var rows []trendRow
		if err := q.Scan(c.Request.Context(), &rows); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load trends"})
			return
		}

		if rows == nil {
			rows = []trendRow{}
		}

		c.JSON(http.StatusOK, gin.H{"data": rows})
	}
}
