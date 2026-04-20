package dashboard

import (
	"context"
	"net/http"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
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
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}
		result := statsResult{
			StatusCounts:   make(map[string]int),
			SeverityTotals: make(map[string]int),
			Operations: operationsResult{
				ActiveXraySteps: make(map[string]int),
				ActiveXrayScans: []models.Scan{},
			},
		}

		// Total scans
		totalQuery := db.NewSelect().Model((*models.Scan)(nil))
		totalQuery = authz.ApplyOwnershipVisibility(totalQuery, "scan", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
		total, _ := totalQuery.Count(ctx)
		result.TotalScans = total

		// Status counts
		type statusRow struct {
			Status         string `bun:"status"`
			ExternalStatus string `bun:"external_status"`
			Count          int    `bun:"count"`
		}
		var statusRows []statusRow
		statusQuery := db.NewSelect().
			TableExpr("scans").
			ColumnExpr("status, external_status, COUNT(*) AS count").
			GroupExpr("status, external_status")
		statusQuery = authz.ApplyOwnershipVisibility(statusQuery, "", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
		statusQuery.Scan(ctx, &statusRows) //nolint:errcheck
		for _, r := range statusRows {
			result.StatusCounts[r.Status] += r.Count
			if isBlockedByXrayPolicyStatus(r.Status, r.ExternalStatus) {
				result.StatusCounts[models.ScanExternalStatusBlockedByXrayPolicy] += r.Count
				result.Operations.BlockedPolicyCount += r.Count
			}
		}

		// Severity totals across scans with finalized findings.
		type severityRow struct {
			Critical int `bun:"critical"`
			High     int `bun:"high"`
			Medium   int `bun:"medium"`
			Low      int `bun:"low"`
			Unknown  int `bun:"unknown"`
		}
		var sev severityRow
		severityQuery := db.NewSelect().
			TableExpr("scans").
			ColumnExpr("COALESCE(SUM(critical_count),0) AS critical, COALESCE(SUM(high_count),0) AS high, COALESCE(SUM(medium_count),0) AS medium, COALESCE(SUM(low_count),0) AS low, COALESCE(SUM(unknown_count),0) AS unknown").
			Where("(status = ? OR (status = ? AND external_status = ?))", models.ScanStatusCompleted, models.ScanStatusFailed, models.ScanExternalStatusBlockedByXrayPolicy)
		severityQuery = authz.ApplyOwnershipVisibility(severityQuery, "", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
		severityQuery.Scan(ctx, &sev) //nolint:errcheck
		result.SeverityTotals["critical"] = sev.Critical
		result.SeverityTotals["high"] = sev.High
		result.SeverityTotals["medium"] = sev.Medium
		result.SeverityTotals["low"] = sev.Low
		result.SeverityTotals["unknown"] = sev.Unknown

		// Recent scans
		recentQuery := db.NewSelect().Model(&result.RecentScans).
			OrderExpr("created_at DESC").
			Limit(5)
		recentQuery = authz.ApplyOwnershipVisibility(recentQuery, "scan", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
		recentQuery.Scan(ctx) //nolint:errcheck
		if result.RecentScans == nil {
			result.RecentScans = []models.Scan{}
		}

		// Active Xray scans and current-step counts.
		var activeXrayScans []models.Scan
		activeXrayQuery := db.NewSelect().Model(&activeXrayScans).
			Where("scan_provider = ?", models.ScanProviderArtifactoryXray).
			Where("status IN (?)", bun.In([]string{models.ScanStatusPending, models.ScanStatusRunning})).
			OrderExpr("created_at DESC")
		activeXrayQuery = authz.ApplyOwnershipVisibility(activeXrayQuery, "scan", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
		activeXrayQuery.Scan(ctx) //nolint:errcheck
		result.Operations.ActiveXrayCount, result.Operations.ActiveXraySteps = summarizeActiveXrayScans(activeXrayScans)
		if len(activeXrayScans) > 5 {
			result.Operations.ActiveXrayScans = append([]models.Scan{}, activeXrayScans[:5]...)
		} else if activeXrayScans != nil {
			result.Operations.ActiveXrayScans = append([]models.Scan{}, activeXrayScans...)
		}

		// Top images by scan count
		result.TopImages = topImages(ctx, db, userID, isAdmin, accessibleOrgIDs)

		// Watchlist count
		watchlistQuery := db.NewSelect().TableExpr("watchlist_items").
			Where("enabled = true")
		watchlistQuery = authz.ApplyOwnershipVisibility(watchlistQuery, "", "user_id", "owner_user_id", "owner_org_id", "org_watchlist_items", "watchlist_item_id", userID, isAdmin, accessibleOrgIDs)
		wlCount, _ := watchlistQuery.Count(ctx)
		result.WatchlistCount = wlCount

		c.JSON(http.StatusOK, result)
	}
}

func isBlockedByXrayPolicyStatus(status, externalStatus string) bool {
	return status == models.ScanStatusFailed && externalStatus == models.ScanExternalStatusBlockedByXrayPolicy
}

func countsTowardDashboardFindings(status, externalStatus string) bool {
	return status == models.ScanStatusCompleted || isBlockedByXrayPolicyStatus(status, externalStatus)
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

func topImages(ctx context.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID) []topImage {
	type row struct {
		ImageName string `bun:"image_name"`
		Count     int    `bun:"count"`
	}
	var rows []row
	query := db.NewSelect().
		TableExpr("scans").
		ColumnExpr("image_name, COUNT(*) AS count").
		GroupExpr("image_name").
		OrderExpr("count DESC").
		Limit(5)
	query = authz.ApplyOwnershipVisibility(query, "", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
	query.Scan(ctx, &rows) //nolint:errcheck
	result := make([]topImage, len(rows))
	for i, r := range rows {
		result[i] = topImage{ImageName: r.ImageName, Count: r.Count}
	}
	return result
}
