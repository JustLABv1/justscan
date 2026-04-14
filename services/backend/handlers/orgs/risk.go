package orgs

import (
	"net/http"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// GetRiskScore computes a risk score (0-100, lower is safer) for an organisation
// based on the latest completed scan for each unique image in the org.
func GetRiskScore(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleMember); !ok {
			return
		}

		ctx := c.Request.Context()

		// Load all scans assigned to this org
		var orgScans []models.OrgScan
		if err := db.NewSelect().Model(&orgScans).Where("org_id = ?", orgID).Scan(ctx); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load org scans"})
			return
		}

		if len(orgScans) == 0 {
			c.JSON(http.StatusOK, gin.H{
				"score":                0,
				"grade":                "A",
				"unique_images":        0,
				"total_scans":          0,
				"totals":               gin.H{"critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0},
				"compliance_pass_rate": 0,
				"compliance_pass":      0,
				"compliance_fail":      0,
			})
			return
		}

		// Collect scan IDs
		scanIDs := make([]uuid.UUID, 0, len(orgScans))
		for _, os := range orgScans {
			scanIDs = append(scanIDs, os.ScanID)
		}

		// Load all completed scans
		var scans []models.Scan
		if err := db.NewSelect().Model(&scans).
			Where("id IN (?)", bun.In(scanIDs)).
			Where("status = ?", models.ScanStatusCompleted).
			Scan(ctx); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scans"})
			return
		}

		// For each unique image_name+image_tag, keep the latest completed scan
		type imageKey struct{ name, tag string }
		latestScans := make(map[imageKey]*models.Scan)
		for i := range scans {
			s := &scans[i]
			key := imageKey{s.ImageName, s.ImageTag}
			existing, ok := latestScans[key]
			if !ok || (s.CompletedAt != nil && (existing.CompletedAt == nil || s.CompletedAt.After(*existing.CompletedAt))) {
				latestScans[key] = s
			}
		}

		uniqueImages := len(latestScans)
		totalScans := len(orgScans)

		var totalCritical, totalHigh, totalMedium, totalLow, totalUnknown int
		for _, s := range latestScans {
			totalCritical += s.CriticalCount
			totalHigh += s.HighCount
			totalMedium += s.MediumCount
			totalLow += s.LowCount
			totalUnknown += s.UnknownCount
		}

		// score = min(100, (critical*10 + high*3 + medium*1) / max(unique_images, 1))
		divisor := uniqueImages
		if divisor < 1 {
			divisor = 1
		}
		rawScore := float64(totalCritical*10+totalHigh*3+totalMedium*1) / float64(divisor)
		score := rawScore
		if score > 100 {
			score = 100
		}

		var grade string
		switch {
		case score <= 10:
			grade = "A"
		case score <= 25:
			grade = "B"
		case score <= 50:
			grade = "C"
		case score <= 75:
			grade = "D"
		default:
			grade = "F"
		}

		// Compliance pass/fail for this org
		type compRow struct {
			Status string `bun:"status"`
			Count  int    `bun:"count"`
		}
		var compRows []compRow
		db.NewSelect().
			TableExpr("compliance_results").
			ColumnExpr("status, COUNT(*) AS count").
			Where("org_id = ?", orgID).
			GroupExpr("status").
			Scan(ctx, &compRows) //nolint:errcheck

		compPass, compFail := 0, 0
		for _, r := range compRows {
			if r.Status == "pass" {
				compPass = r.Count
			} else {
				compFail = r.Count
			}
		}
		compTotal := compPass + compFail
		var compPassRate float64
		if compTotal > 0 {
			compPassRate = float64(compPass) / float64(compTotal)
		}

		c.JSON(http.StatusOK, gin.H{
			"score":         score,
			"grade":         grade,
			"unique_images": uniqueImages,
			"total_scans":   totalScans,
			"totals": gin.H{
				"critical": totalCritical,
				"high":     totalHigh,
				"medium":   totalMedium,
				"low":      totalLow,
				"unknown":  totalUnknown,
			},
			"compliance_pass_rate": compPassRate,
			"compliance_pass":      compPass,
			"compliance_fail":      compFail,
		})
	}
}
