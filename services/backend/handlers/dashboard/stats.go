package dashboard

import (
	"context"
	"net/http"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

type statsResult struct {
	TotalScans     int            `json:"total_scans"`
	StatusCounts   map[string]int `json:"status_counts"`
	SeverityTotals map[string]int `json:"severity_totals"`
	RecentScans    []models.Scan  `json:"recent_scans"`
	TopImages      []topImage     `json:"top_images"`
	WatchlistCount int            `json:"watchlist_count"`
}

type topImage struct {
	ImageName string `json:"image_name"`
	Count     int    `json:"count"`
}

func GetStats(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		result := statsResult{
			StatusCounts:   make(map[string]int),
			SeverityTotals: make(map[string]int),
		}

		// Total scans
		total, _ := db.NewSelect().Model((*models.Scan)(nil)).Count(ctx)
		result.TotalScans = total

		// Status counts
		type statusRow struct {
			Status string `bun:"status"`
			Count  int    `bun:"count"`
		}
		var statusRows []statusRow
		db.NewSelect().
			TableExpr("scans").
			ColumnExpr("status, COUNT(*) AS count").
			GroupExpr("status").
			Scan(ctx, &statusRows) //nolint:errcheck
		for _, r := range statusRows {
			result.StatusCounts[r.Status] = r.Count
		}

		// Severity totals across completed scans
		type severityRow struct {
			Critical int `bun:"critical"`
			High     int `bun:"high"`
			Medium   int `bun:"medium"`
			Low      int `bun:"low"`
			Unknown  int `bun:"unknown"`
		}
		var sev severityRow
		db.NewSelect().
			TableExpr("scans").
			ColumnExpr("COALESCE(SUM(critical_count),0) AS critical, COALESCE(SUM(high_count),0) AS high, COALESCE(SUM(medium_count),0) AS medium, COALESCE(SUM(low_count),0) AS low, COALESCE(SUM(unknown_count),0) AS unknown").
			Where("status = ?", models.ScanStatusCompleted).
			Scan(ctx, &sev) //nolint:errcheck
		result.SeverityTotals["critical"] = sev.Critical
		result.SeverityTotals["high"] = sev.High
		result.SeverityTotals["medium"] = sev.Medium
		result.SeverityTotals["low"] = sev.Low
		result.SeverityTotals["unknown"] = sev.Unknown

		// Recent scans
		db.NewSelect().Model(&result.RecentScans).
			OrderExpr("created_at DESC").
			Limit(5).
			Scan(ctx) //nolint:errcheck

		// Top images by scan count
		result.TopImages = topImages(ctx, db)

		// Watchlist count
		wlCount, _ := db.NewSelect().Model((*models.WatchlistItem)(nil)).
			Where("enabled = true").
			Count(ctx)
		result.WatchlistCount = wlCount

		c.JSON(http.StatusOK, result)
	}
}

func topImages(ctx context.Context, db *bun.DB) []topImage {
	type row struct {
		ImageName string `bun:"image_name"`
		Count     int    `bun:"count"`
	}
	var rows []row
	db.NewSelect().
		TableExpr("scans").
		ColumnExpr("image_name, COUNT(*) AS count").
		GroupExpr("image_name").
		OrderExpr("count DESC").
		Limit(5).
		Scan(ctx, &rows) //nolint:errcheck
	result := make([]topImage, len(rows))
	for i, r := range rows {
		result[i] = topImage{ImageName: r.ImageName, Count: r.Count}
	}
	return result
}
