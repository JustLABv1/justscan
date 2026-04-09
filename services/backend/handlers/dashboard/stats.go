package dashboard

import (
	"context"
	"net/http"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

type statsResult struct {
	TotalScans     int              `json:"total_scans"`
	StatusCounts   map[string]int   `json:"status_counts"`
	SeverityTotals map[string]int   `json:"severity_totals"`
	RecentScans    []models.Scan    `json:"recent_scans"`
	TopImages      []topImage       `json:"top_images"`
	WatchlistCount int              `json:"watchlist_count"`
	Operations     operationsResult `json:"operations"`
}

type operationsResult struct {
	BlockedPolicyCount int            `json:"blocked_policy_count"`
	ActiveXrayCount    int            `json:"active_xray_count"`
	ActiveXraySteps    map[string]int `json:"active_xray_step_counts"`
	ActiveXrayScans    []models.Scan  `json:"active_xray_scans"`
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
			Operations: operationsResult{
				ActiveXraySteps: make(map[string]int),
				ActiveXrayScans: []models.Scan{},
			},
		}

		// Total scans
		total, _ := db.NewSelect().Model((*models.Scan)(nil)).Count(ctx)
		result.TotalScans = total

		// Status counts
		type statusRow struct {
			Status         string `bun:"status"`
			ExternalStatus string `bun:"external_status"`
			Count          int    `bun:"count"`
		}
		var statusRows []statusRow
		db.NewSelect().
			TableExpr("scans").
			ColumnExpr("status, external_status, COUNT(*) AS count").
			GroupExpr("status, external_status").
			Scan(ctx, &statusRows) //nolint:errcheck
		for _, r := range statusRows {
			result.StatusCounts[r.Status] += r.Count
			if isBlockedByXrayPolicyStatus(r.Status, r.ExternalStatus) {
				result.StatusCounts[models.ScanExternalStatusBlockedByXrayPolicy] += r.Count
				result.Operations.BlockedPolicyCount += r.Count
			}
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
		if result.RecentScans == nil {
			result.RecentScans = []models.Scan{}
		}

		// Active Xray scans and current-step counts.
		var activeXrayScans []models.Scan
		db.NewSelect().Model(&activeXrayScans).
			Where("scan_provider = ?", models.ScanProviderArtifactoryXray).
			Where("status IN (?)", bun.In([]string{models.ScanStatusPending, models.ScanStatusRunning})).
			OrderExpr("created_at DESC").
			Scan(ctx) //nolint:errcheck
		result.Operations.ActiveXrayCount, result.Operations.ActiveXraySteps = summarizeActiveXrayScans(activeXrayScans)
		if len(activeXrayScans) > 5 {
			result.Operations.ActiveXrayScans = append([]models.Scan{}, activeXrayScans[:5]...)
		} else if activeXrayScans != nil {
			result.Operations.ActiveXrayScans = append([]models.Scan{}, activeXrayScans...)
		}

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

func isBlockedByXrayPolicyStatus(status, externalStatus string) bool {
	return status == models.ScanStatusFailed && externalStatus == models.ScanExternalStatusBlockedByXrayPolicy
}

func summarizeActiveXrayScans(scans []models.Scan) (int, map[string]int) {
	stepCounts := make(map[string]int)
	for _, scan := range scans {
		step := scan.CurrentStep
		if step == "" {
			step = models.ScanStepQueued
		}
		stepCounts[step]++
	}
	return len(scans), stepCounts
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
