package admins

import (
	"math"
	"net/http"
	"sort"
	"time"

	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

type adminDashboardResponse struct {
	GeneratedAt         time.Time                    `json:"generated_at"`
	PublicScanEnabled   bool                         `json:"public_scan_enabled"`
	TotalScans          int                          `json:"total_scans"`
	StatusCounts        map[string]int               `json:"status_counts"`
	SeverityTotals      map[string]int               `json:"severity_totals"`
	Queues              adminDashboardQueues         `json:"queues"`
	AdminCounts         adminDashboardCounts         `json:"admin_counts"`
	Insights            adminDashboardInsights       `json:"insights"`
	ScannerHealth       scanner.HealthReport         `json:"scanner_health"`
	RecentAudit         []models.AuditWithUser       `json:"recent_audit"`
	ScanTrends          []adminScanTrendRow          `json:"scan_trends"`
	VulnerabilityTrends []adminVulnerabilityTrendRow `json:"vulnerability_trends"`
}

type adminDashboardQueues struct {
	Running         int `json:"running"`
	Pending         int `json:"pending"`
	Failed          int `json:"failed"`
	BlockedPolicies int `json:"blocked_policies"`
	NeedsAttention  int `json:"needs_attention"`
}

type adminDashboardCounts struct {
	Users             int `json:"users"`
	Tokens            int `json:"tokens"`
	ActiveChannels    int `json:"active_channels"`
	IdentityProviders int `json:"identity_providers"`
	GlobalRegistries  int `json:"global_registries"`
}

type adminDashboardInsights struct {
	APIRequests24h       int64   `json:"api_requests_24h"`
	APIErrorRequests24h  int64   `json:"api_error_requests_24h"`
	APIAverageMs         float64 `json:"api_average_ms"`
	APIP95Ms             float64 `json:"api_p95_ms"`
	XrayRequests24h      int64   `json:"xray_requests_24h"`
	XrayErrorRequests24h int64   `json:"xray_error_requests_24h"`
}

type adminScanTrendRow struct {
	Date      string `bun:"date" json:"date"`
	Total     int64  `bun:"total" json:"total"`
	Completed int64  `bun:"completed" json:"completed"`
	Failed    int64  `bun:"failed" json:"failed"`
}

type adminVulnerabilityTrendRow struct {
	Date     string `bun:"date" json:"date"`
	Critical int64  `bun:"critical" json:"critical"`
	High     int64  `bun:"high" json:"high"`
	Medium   int64  `bun:"medium" json:"medium"`
	Low      int64  `bun:"low" json:"low"`
	Unknown  int64  `bun:"unknown" json:"unknown"`
}

type adminVulnerabilityTrendSample struct {
	Status         string     `bun:"status"`
	ExternalStatus string     `bun:"external_status"`
	CompletedAt    *time.Time `bun:"completed_at"`
	Critical       int        `bun:"critical_count"`
	High           int        `bun:"high_count"`
	Medium         int        `bun:"medium_count"`
	Low            int        `bun:"low_count"`
	Unknown        int        `bun:"unknown_count"`
}

type adminVulnerabilityAccumulator struct {
	count    int
	critical int
	high     int
	medium   int
	low      int
	unknown  int
}

// GetDashboard returns a system-wide admin dashboard summary.
func GetDashboard(c *gin.Context, db *bun.DB) {
	ctx := c.Request.Context()
	now := time.Now().UTC()
	cutoff30d := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -29)
	cutoff24h := now.Add(-24 * time.Hour)

	response := adminDashboardResponse{
		GeneratedAt:         now,
		PublicScanEnabled:   true,
		StatusCounts:        make(map[string]int),
		SeverityTotals:      make(map[string]int),
		RecentAudit:         []models.AuditWithUser{},
		ScanTrends:          []adminScanTrendRow{},
		VulnerabilityTrends: []adminVulnerabilityTrendRow{},
	}

	var publicScanSetting models.SystemSetting
	if err := db.NewSelect().Model(&publicScanSetting).Where("key = ?", "public_scan_enabled").Limit(1).Scan(ctx); err == nil {
		response.PublicScanEnabled = publicScanSetting.Value != "false"
	}

	response.ScannerHealth = scanner.GetHealthReport(ctx)

	totalScans, _ := db.NewSelect().TableExpr("scans").Count(ctx)
	response.TotalScans = totalScans

	type statusRow struct {
		Status         string `bun:"status"`
		ExternalStatus string `bun:"external_status"`
		Count          int    `bun:"count"`
	}
	var statusRows []statusRow
	_ = db.NewSelect().
		TableExpr("scans").
		ColumnExpr("status, external_status, COUNT(*) AS count").
		GroupExpr("status, external_status").
		Scan(ctx, &statusRows)
	for _, row := range statusRows {
		response.StatusCounts[row.Status] += row.Count
		if isBlockedByXrayPolicy(row.Status, row.ExternalStatus) {
			response.StatusCounts[models.ScanExternalStatusBlockedByXrayPolicy] += row.Count
			response.Queues.BlockedPolicies += row.Count
		}
	}
	response.Queues.Running = response.StatusCounts[models.ScanStatusRunning]
	response.Queues.Pending = response.StatusCounts[models.ScanStatusPending]
	response.Queues.Failed = response.StatusCounts[models.ScanStatusFailed]
	response.Queues.NeedsAttention = response.Queues.Failed + response.Queues.BlockedPolicies

	type severityRow struct {
		Critical int `bun:"critical"`
		High     int `bun:"high"`
		Medium   int `bun:"medium"`
		Low      int `bun:"low"`
		Unknown  int `bun:"unknown"`
	}
	var severity severityRow
	_ = db.NewSelect().
		TableExpr("scans").
		ColumnExpr("COALESCE(SUM(critical_count),0) AS critical, COALESCE(SUM(high_count),0) AS high, COALESCE(SUM(medium_count),0) AS medium, COALESCE(SUM(low_count),0) AS low, COALESCE(SUM(unknown_count),0) AS unknown").
		Where("(status = ? OR (status = ? AND external_status = ?))", models.ScanStatusCompleted, models.ScanStatusFailed, models.ScanExternalStatusBlockedByXrayPolicy).
		Scan(ctx, &severity)
	response.SeverityTotals["critical"] = severity.Critical
	response.SeverityTotals["high"] = severity.High
	response.SeverityTotals["medium"] = severity.Medium
	response.SeverityTotals["low"] = severity.Low
	response.SeverityTotals["unknown"] = severity.Unknown

	_ = db.NewSelect().
		TableExpr("scans").
		ColumnExpr("to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date").
		ColumnExpr("COUNT(*) AS total").
		ColumnExpr("SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed").
		ColumnExpr("SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed").
		Where("created_at >= ?", cutoff30d).
		GroupExpr("date").
		OrderExpr("date ASC").
		Scan(ctx, &response.ScanTrends)
	if response.ScanTrends == nil {
		response.ScanTrends = []adminScanTrendRow{}
	}

	var vulnSamples []adminVulnerabilityTrendSample
	_ = db.NewSelect().
		TableExpr("scans").
		Column("status", "external_status", "completed_at", "critical_count", "high_count", "medium_count", "low_count", "unknown_count").
		Where("(status = ? OR (status = ? AND external_status = ?))", models.ScanStatusCompleted, models.ScanStatusFailed, models.ScanExternalStatusBlockedByXrayPolicy).
		Where("completed_at IS NOT NULL").
		Where("completed_at >= ?", cutoff30d).
		OrderExpr("completed_at ASC").
		Scan(ctx, &vulnSamples)
	response.VulnerabilityTrends = aggregateAdminVulnerabilityTrendRows(vulnSamples)

	response.AdminCounts.Users, _ = db.NewSelect().TableExpr("users").Count(ctx)
	response.AdminCounts.Tokens, _ = db.NewSelect().TableExpr("tokens").Count(ctx)
	response.AdminCounts.ActiveChannels, _ = db.NewSelect().TableExpr("notification_channels").Where("enabled = true").Count(ctx)
	response.AdminCounts.IdentityProviders, _ = db.NewSelect().TableExpr("oidc_providers").Count(ctx)
	response.AdminCounts.GlobalRegistries, _ = db.NewSelect().TableExpr("registries").Where("owner_type = ?", "system").Count(ctx)

	var requestSummary struct {
		Total  int64   `bun:"total"`
		Errors int64   `bun:"errors"`
		Avg    float64 `bun:"avg_ms"`
		P95    float64 `bun:"p95_ms"`
	}
	_ = db.NewSelect().
		TableExpr("api_request_logs").
		ColumnExpr("COUNT(*) AS total").
		ColumnExpr("COUNT(*) FILTER (WHERE status_code >= 400) AS errors").
		ColumnExpr("COALESCE(AVG(duration_ms), 0) AS avg_ms").
		ColumnExpr("COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 0) AS p95_ms").
		Where("created_at >= ?", cutoff24h).
		Scan(ctx, &requestSummary)
	response.Insights.APIRequests24h = requestSummary.Total
	response.Insights.APIErrorRequests24h = requestSummary.Errors
	response.Insights.APIAverageMs = requestSummary.Avg
	response.Insights.APIP95Ms = requestSummary.P95

	type xraySummary struct {
		Total  int64 `bun:"total"`
		Errors int64 `bun:"errors"`
	}
	var xray xraySummary
	_ = db.NewSelect().
		TableExpr("xray_request_logs").
		ColumnExpr("COUNT(*) AS total").
		ColumnExpr("COUNT(*) FILTER (WHERE status_code >= 400 OR COALESCE(error, '') <> '') AS errors").
		Where("created_at >= ?", cutoff24h).
		Scan(ctx, &xray)
	response.Insights.XrayRequests24h = xray.Total
	response.Insights.XrayErrorRequests24h = xray.Errors

	_ = db.NewSelect().
		TableExpr("audit a").
		ColumnExpr("a.*, u.username, u.email, u.role").
		Join("LEFT JOIN users u ON u.id::text = a.user_id").
		OrderExpr("a.created_at DESC").
		Limit(5).
		Scan(ctx, &response.RecentAudit)
	if response.RecentAudit == nil {
		response.RecentAudit = []models.AuditWithUser{}
	}

	c.JSON(http.StatusOK, response)
}

func isBlockedByXrayPolicy(status, externalStatus string) bool {
	return status == models.ScanStatusFailed && externalStatus == models.ScanExternalStatusBlockedByXrayPolicy
}

func aggregateAdminVulnerabilityTrendRows(samples []adminVulnerabilityTrendSample) []adminVulnerabilityTrendRow {
	if len(samples) == 0 {
		return []adminVulnerabilityTrendRow{}
	}

	buckets := make(map[string]*adminVulnerabilityAccumulator)
	for _, sample := range samples {
		if !countsTowardAdminFindings(sample.Status, sample.ExternalStatus) || sample.CompletedAt == nil {
			continue
		}
		key := sample.CompletedAt.UTC().Format("2006-01-02")
		acc, ok := buckets[key]
		if !ok {
			acc = &adminVulnerabilityAccumulator{}
			buckets[key] = acc
		}
		acc.count++
		acc.critical += sample.Critical
		acc.high += sample.High
		acc.medium += sample.Medium
		acc.low += sample.Low
		acc.unknown += sample.Unknown
	}

	if len(buckets) == 0 {
		return []adminVulnerabilityTrendRow{}
	}

	dates := make([]string, 0, len(buckets))
	for date := range buckets {
		dates = append(dates, date)
	}
	sort.Strings(dates)

	rows := make([]adminVulnerabilityTrendRow, 0, len(dates))
	for _, date := range dates {
		acc := buckets[date]
		rows = append(rows, adminVulnerabilityTrendRow{
			Date:     date,
			Critical: roundAdminAverage(acc.critical, acc.count),
			High:     roundAdminAverage(acc.high, acc.count),
			Medium:   roundAdminAverage(acc.medium, acc.count),
			Low:      roundAdminAverage(acc.low, acc.count),
			Unknown:  roundAdminAverage(acc.unknown, acc.count),
		})
	}

	return rows
}

func countsTowardAdminFindings(status, externalStatus string) bool {
	return status == models.ScanStatusCompleted || isBlockedByXrayPolicy(status, externalStatus)
}

func roundAdminAverage(sum, count int) int64 {
	if count == 0 {
		return 0
	}
	return int64(math.Round(float64(sum) / float64(count)))
}
