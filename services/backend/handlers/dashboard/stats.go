package dashboard

import (
	"context"
	"net/http"
	"strings"

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
	AttentionScans []models.Scan    `json:"attention_scans"`
	RecentScans    []models.Scan    `json:"recent_scans"`
	TopImages      []topImage       `json:"top_images"`
	WatchlistCount int              `json:"watchlist_count"`
	Operations     operationsResult `json:"operations"`
}

type operationsResult struct {
	BlockedPolicyCount int            `json:"blocked_policy_count"`
	XrayBlockedCount   int            `json:"xray_blocked_count"`
	OrgPolicyFailCount int            `json:"org_policy_fail_count"`
	ActiveXrayCount    int            `json:"active_xray_count"`
	ActiveXraySteps    map[string]int `json:"active_xray_step_counts"`
	ActiveXrayScans    []models.Scan  `json:"active_xray_scans"`
}

type topImage struct {
	ImageName string `json:"image_name"`
	Count     int    `json:"count"`
}

const dashboardAttentionScanLimit = 25

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
		totalQuery = authz.ApplyWorkspaceScope(c, totalQuery, "scan", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
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
		statusQuery = authz.ApplyWorkspaceScope(c, statusQuery, "", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
		statusQuery.Scan(ctx, &statusRows) //nolint:errcheck
		for _, r := range statusRows {
			result.StatusCounts[r.Status] += r.Count
			if isBlockedByXrayPolicyStatus(r.Status, r.ExternalStatus) {
				result.StatusCounts[models.ScanExternalStatusBlockedByXrayPolicy] += r.Count
			}
		}

		policyCounts, policyCountErr := loadPolicyIssueCounts(c, ctx, db, userID, isAdmin, accessibleOrgIDs)
		if policyCountErr == nil {
			result.Operations.BlockedPolicyCount = policyCounts.total
			result.Operations.XrayBlockedCount = policyCounts.xrayBlocked
			result.Operations.OrgPolicyFailCount = policyCounts.orgPolicyFailed
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
		severityQuery = authz.ApplyWorkspaceScope(c, severityQuery, "", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
		severityQuery.Scan(ctx, &sev) //nolint:errcheck
		result.SeverityTotals["critical"] = sev.Critical
		result.SeverityTotals["high"] = sev.High
		result.SeverityTotals["medium"] = sev.Medium
		result.SeverityTotals["low"] = sev.Low
		result.SeverityTotals["unknown"] = sev.Unknown

		// Attention scans back the dashboard triage list and are broader than the
		// compact recent-scans list.
		attentionQuery := db.NewSelect().Model(&result.AttentionScans).
			Where(
				"(status = ? OR status IN (?) OR external_status = ?)",
				models.ScanStatusFailed,
				bun.In([]string{models.ScanStatusPending, models.ScanStatusRunning}),
				models.ScanExternalStatusBlockedByXrayPolicy,
			).
			OrderExpr("created_at DESC").
			Limit(dashboardAttentionScanLimit)
		attentionQuery = authz.ApplyOwnershipVisibility(attentionQuery, "scan", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
		attentionQuery = authz.ApplyWorkspaceScope(c, attentionQuery, "scan", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
		attentionQuery.Scan(ctx) //nolint:errcheck
		if result.AttentionScans == nil {
			result.AttentionScans = []models.Scan{}
		}

		// Recent scans
		recentQuery := db.NewSelect().Model(&result.RecentScans).
			OrderExpr("created_at DESC").
			Limit(5)
		recentQuery = authz.ApplyOwnershipVisibility(recentQuery, "scan", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
		recentQuery = authz.ApplyWorkspaceScope(c, recentQuery, "scan", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
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
		activeXrayQuery = authz.ApplyWorkspaceScope(c, activeXrayQuery, "scan", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
		activeXrayQuery.Scan(ctx) //nolint:errcheck
		result.Operations.ActiveXrayCount, result.Operations.ActiveXraySteps = summarizeActiveXrayScans(activeXrayScans)
		if len(activeXrayScans) > 5 {
			result.Operations.ActiveXrayScans = append([]models.Scan{}, activeXrayScans[:5]...)
		} else if activeXrayScans != nil {
			result.Operations.ActiveXrayScans = append([]models.Scan{}, activeXrayScans...)
		}

		// Top images by scan count
		result.TopImages = topImages(c, ctx, db, userID, isAdmin, accessibleOrgIDs)

		// Watchlist count
		watchlistQuery := db.NewSelect().TableExpr("watchlist_items").
			Where("enabled = true")
		watchlistQuery = authz.ApplyOwnershipVisibility(watchlistQuery, "", "user_id", "owner_user_id", "owner_org_id", "org_watchlist_items", "watchlist_item_id", userID, isAdmin, accessibleOrgIDs)
		watchlistQuery = authz.ApplyWorkspaceScope(c, watchlistQuery, "", "owner_user_id", "owner_org_id", "org_watchlist_items", "watchlist_item_id", userID)
		wlCount, _ := watchlistQuery.Count(ctx)
		result.WatchlistCount = wlCount

		c.JSON(http.StatusOK, result)
	}
}

func isBlockedByXrayPolicyStatus(status, externalStatus string) bool {
	return externalStatus == models.ScanExternalStatusBlockedByXrayPolicy
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

func topImages(c *gin.Context, ctx context.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID) []topImage {
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
	query = authz.ApplyWorkspaceScope(c, query, "", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
	query.Scan(ctx, &rows) //nolint:errcheck
	result := make([]topImage, len(rows))
	for i, r := range rows {
		result[i] = topImage{ImageName: r.ImageName, Count: r.Count}
	}
	return result
}

type dashboardPolicyIssueCounts struct {
	total           int
	xrayBlocked     int
	orgPolicyFailed int
}

func loadPolicyIssueCounts(c *gin.Context, ctx context.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID) (dashboardPolicyIssueCounts, error) {
	result := dashboardPolicyIssueCounts{}
	issueScanIDs := make(map[uuid.UUID]struct{})

	var xrayBlockedScanIDs []uuid.UUID
	xrayBlockedQuery := db.NewSelect().
		TableExpr("scans").
		Column("id").
		Where("id IN (?)", latestVisibleScanIDsQuery(c, db, userID, isAdmin, accessibleOrgIDs, "latest_policy_scan")).
		Where("external_status = ?", models.ScanExternalStatusBlockedByXrayPolicy)
	xrayBlockedQuery = authz.ApplyOwnershipVisibility(xrayBlockedQuery, "", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
	xrayBlockedQuery = authz.ApplyWorkspaceScope(c, xrayBlockedQuery, "", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
	if err := xrayBlockedQuery.Scan(ctx, &xrayBlockedScanIDs); err != nil {
		return result, err
	}
	result.xrayBlocked = len(xrayBlockedScanIDs)
	for _, scanID := range xrayBlockedScanIDs {
		issueScanIDs[scanID] = struct{}{}
	}

	var orgPolicyFailedScanIDs []uuid.UUID
	orgPolicyQuery := db.NewSelect().
		TableExpr("compliance_results AS cr").
		ColumnExpr("DISTINCT cr.scan_id").
		Join("JOIN scans AS s ON s.id = cr.scan_id").
		Where("cr.scan_id IN (?)", latestVisibleScanIDsQuery(c, db, userID, isAdmin, accessibleOrgIDs, "latest_policy_scan")).
		Where("cr.status = ?", "fail")
	orgPolicyQuery = authz.ApplyOwnershipVisibility(orgPolicyQuery, "s", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
	orgPolicyQuery = authz.ApplyWorkspaceScope(c, orgPolicyQuery, "s", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
	if !isAdmin {
		if len(accessibleOrgIDs) == 0 {
			result.total = len(issueScanIDs)
			return result, nil
		}
		orgPolicyQuery = orgPolicyQuery.Where("cr.org_id IN (?)", bun.In(accessibleOrgIDs))
	}
	if orgID, scoped := scopedOrgID(c.Query("scope")); scoped {
		orgPolicyQuery = orgPolicyQuery.Where("cr.org_id = ?", orgID)
	}
	if err := orgPolicyQuery.Scan(ctx, &orgPolicyFailedScanIDs); err != nil {
		return result, err
	}
	result.orgPolicyFailed = len(orgPolicyFailedScanIDs)
	for _, scanID := range orgPolicyFailedScanIDs {
		issueScanIDs[scanID] = struct{}{}
	}

	result.total = len(issueScanIDs)
	return result, nil
}

func latestVisibleScanIDsQuery(c *gin.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID, alias string) *bun.SelectQuery {
	q := db.NewSelect().
		TableExpr("scans AS " + alias).
		ColumnExpr(
			"DISTINCT ON (" + alias + ".image_name, " + alias + ".image_tag, COALESCE(" + alias + ".platform, ''), " + alias + ".owner_type, COALESCE(" + alias + ".owner_user_id::text, ''), COALESCE(" + alias + ".owner_org_id::text, '')) " + alias + ".id",
		).
		OrderExpr(
			alias + ".image_name, " +
				alias + ".image_tag, " +
				"COALESCE(" + alias + ".platform, ''), " +
				alias + ".owner_type, " +
				"COALESCE(" + alias + ".owner_user_id::text, ''), " +
				"COALESCE(" + alias + ".owner_org_id::text, ''), " +
				alias + ".created_at DESC, " +
				alias + ".id DESC",
		)
	q = authz.ApplyOwnershipVisibility(q, alias, "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
	q = authz.ApplyWorkspaceScope(c, q, alias, "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
	return q
}

func scopedOrgID(scope string) (uuid.UUID, bool) {
	trimmed := strings.TrimSpace(scope)
	if trimmed == "" || strings.EqualFold(trimmed, "personal") {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(trimmed)
	return id, err == nil
}
