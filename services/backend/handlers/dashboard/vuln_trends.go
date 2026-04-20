package dashboard

import (
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

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

type vulnTrendSample struct {
	Status         string     `bun:"status"`
	ExternalStatus string     `bun:"external_status"`
	CompletedAt    *time.Time `bun:"completed_at"`
	Critical       int        `bun:"critical_count"`
	High           int        `bun:"high_count"`
	Medium         int        `bun:"medium_count"`
	Low            int        `bun:"low_count"`
	Unknown        int        `bun:"unknown_count"`
}

type vulnTrendAccumulator struct {
	count    int
	critical int
	high     int
	medium   int
	low      int
	unknown  int
}

// GetVulnTrends returns daily vulnerability counts (by severity) from scans with finalized findings.
// Query param: days (1–365, default 30)
func GetVulnTrends(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}

		days := 30
		if d := c.Query("days"); d != "" {
			if n, err := strconv.Atoi(d); err == nil && n > 0 && n <= 365 {
				days = n
			}
		}
		now := time.Now().UTC()
		cutoff := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -days+1)

		var samples []vulnTrendSample
		query := db.NewSelect().
			TableExpr("scans").
			Column("status", "external_status", "completed_at", "critical_count", "high_count", "medium_count", "low_count", "unknown_count").
			Where("(status = ? OR (status = ? AND external_status = ?))", models.ScanStatusCompleted, models.ScanStatusFailed, models.ScanExternalStatusBlockedByXrayPolicy).
			Where("completed_at IS NOT NULL").
			Where("completed_at >= ?", cutoff).
			OrderExpr("completed_at ASC")
		query = authz.ApplyOwnershipVisibility(query, "", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
		query.Scan(ctx, &samples) //nolint:errcheck

		rows := aggregateVulnTrendRows(samples)

		c.JSON(http.StatusOK, gin.H{"data": rows})
	}
}

func aggregateVulnTrendRows(samples []vulnTrendSample) []vulnTrendRow {
	if len(samples) == 0 {
		return []vulnTrendRow{}
	}

	buckets := make(map[string]*vulnTrendAccumulator)
	for _, sample := range samples {
		if !countsTowardDashboardFindings(sample.Status, sample.ExternalStatus) || sample.CompletedAt == nil {
			continue
		}
		key := sample.CompletedAt.UTC().Format("2006-01-02")
		acc, ok := buckets[key]
		if !ok {
			acc = &vulnTrendAccumulator{}
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
		return []vulnTrendRow{}
	}

	dates := make([]string, 0, len(buckets))
	for date := range buckets {
		dates = append(dates, date)
	}
	sort.Strings(dates)

	rows := make([]vulnTrendRow, 0, len(dates))
	for _, date := range dates {
		acc := buckets[date]
		rows = append(rows, vulnTrendRow{
			Date:     date,
			Critical: roundAverage(acc.critical, acc.count),
			High:     roundAverage(acc.high, acc.count),
			Medium:   roundAverage(acc.medium, acc.count),
			Low:      roundAverage(acc.low, acc.count),
			Unknown:  roundAverage(acc.unknown, acc.count),
		})
	}

	return rows
}

func roundAverage(sum, count int) int64 {
	if count == 0 {
		return 0
	}
	return int64(math.Round(float64(sum) / float64(count)))
}
