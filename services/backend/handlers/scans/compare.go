package scans

import (
	"net/http"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func GetSBOM(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		var components []models.SBOMComponent
		q := db.NewSelect().Model(&components).Where("scan_id = ?", scanID).OrderExpr("name, version")

		if t := c.Query("type"); t != "" {
			q = q.Where("type = ?", t)
		}
		if name := c.Query("name"); name != "" {
			q = q.Where("name ILIKE ?", "%"+name+"%")
		}

		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load SBOM"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": components, "total": len(components)})
	}
}

func CompareScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanAStr := c.Query("scan_a")
		scanBStr := c.Query("scan_b")

		scanA, err := uuid.Parse(scanAStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan_a ID"})
			return
		}
		scanB, err := uuid.Parse(scanBStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan_b ID"})
			return
		}

		ctx := c.Request.Context()

		var vulnsA, vulnsB []models.Vulnerability
		if err := db.NewSelect().Model(&vulnsA).Where("scan_id = ?", scanA).Scan(ctx); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan A vulnerabilities"})
			return
		}
		if err := db.NewSelect().Model(&vulnsB).Where("scan_id = ?", scanB).Scan(ctx); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan B vulnerabilities"})
			return
		}

		mapA := make(map[string]models.Vulnerability)
		for _, v := range vulnsA {
			mapA[v.VulnID+"|"+v.PkgName] = v
		}
		mapB := make(map[string]models.Vulnerability)
		for _, v := range vulnsB {
			mapB[v.VulnID+"|"+v.PkgName] = v
		}

		var added, removed, unchanged []models.Vulnerability
		for key, v := range mapB {
			if _, exists := mapA[key]; exists {
				unchanged = append(unchanged, v)
			} else {
				added = append(added, v)
			}
		}
		for key, v := range mapA {
			if _, exists := mapB[key]; !exists {
				removed = append(removed, v)
			}
		}

		// Compute severity delta
		countsA := countSevMap(vulnsA)
		countsB := countSevMap(vulnsB)
		delta := map[string]int{}
		for sev, count := range countsB {
			delta[sev] = count - countsA[sev]
		}

		c.JSON(http.StatusOK, gin.H{
			"added":          added,
			"removed":        removed,
			"unchanged":      unchanged,
			"severity_delta": delta,
			"summary": gin.H{
				"added_count":     len(added),
				"removed_count":   len(removed),
				"unchanged_count": len(unchanged),
			},
		})
	}
}

func countSevMap(vulns []models.Vulnerability) map[string]int {
	m := map[string]int{}
	for _, v := range vulns {
		m[v.Severity]++
	}
	return m
}

type compareVuln struct {
	VulnID           string  `bun:"vuln_id" json:"vuln_id"`
	PkgName          string  `bun:"pkg_name" json:"pkg_name"`
	InstalledVersion string  `bun:"installed_version" json:"installed_version"`
	FixedVersion     string  `bun:"fixed_version" json:"fixed_version"`
	Severity         string  `bun:"severity" json:"severity"`
	Title            string  `bun:"title" json:"title"`
	CVSSScore        float64 `bun:"cvss_score" json:"cvss_score"`
}

// Compare compares vulnerabilities of two scans identified by query params `a` and `b`.
// It returns richer scan metadata alongside the diff.
func Compare(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		aParam := c.Query("a")
		bParam := c.Query("b")

		scanAID, err := uuid.Parse(aParam)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID for param 'a'"})
			return
		}
		scanBID, err := uuid.Parse(bParam)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID for param 'b'"})
			return
		}

		ctx := c.Request.Context()

		scanA := &models.Scan{}
		if err := db.NewSelect().Model(scanA).Where("id = ?", scanAID).Scan(ctx); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "scan A not found"})
			return
		}

		scanB := &models.Scan{}
		if err := db.NewSelect().Model(scanB).Where("id = ?", scanBID).Scan(ctx); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "scan B not found"})
			return
		}

		var vulnsA []compareVuln
		db.NewSelect().
			TableExpr("vulnerabilities").
			ColumnExpr("vuln_id, pkg_name, installed_version, fixed_version, severity, title, cvss_score").
			Where("scan_id = ?", scanAID).
			Scan(ctx, &vulnsA) //nolint:errcheck

		var vulnsB []compareVuln
		db.NewSelect().
			TableExpr("vulnerabilities").
			ColumnExpr("vuln_id, pkg_name, installed_version, fixed_version, severity, title, cvss_score").
			Where("scan_id = ?", scanBID).
			Scan(ctx, &vulnsB) //nolint:errcheck

		// Build lookup maps by (vuln_id + pkg_name)
		mapA := make(map[string]compareVuln, len(vulnsA))
		for _, v := range vulnsA {
			mapA[v.VulnID+"|"+v.PkgName] = v
		}
		mapB := make(map[string]compareVuln, len(vulnsB))
		for _, v := range vulnsB {
			mapB[v.VulnID+"|"+v.PkgName] = v
		}

		var added, removed, unchanged []compareVuln
		for key, v := range mapB {
			if _, inA := mapA[key]; inA {
				unchanged = append(unchanged, v)
			} else {
				added = append(added, v)
			}
		}
		for key, v := range mapA {
			if _, inB := mapB[key]; !inB {
				removed = append(removed, v)
			}
		}

		addedCritical, addedHigh := 0, 0
		for _, v := range added {
			switch v.Severity {
			case models.SeverityCritical:
				addedCritical++
			case models.SeverityHigh:
				addedHigh++
			}
		}

		if added == nil {
			added = []compareVuln{}
		}
		if removed == nil {
			removed = []compareVuln{}
		}
		if unchanged == nil {
			unchanged = []compareVuln{}
		}

		c.JSON(http.StatusOK, gin.H{
			"scan_a":    scanA,
			"scan_b":    scanB,
			"added":     added,
			"removed":   removed,
			"unchanged": unchanged,
			"summary": gin.H{
				"added_count":     len(added),
				"removed_count":   len(removed),
				"unchanged_count": len(unchanged),
				"added_critical":  addedCritical,
				"added_high":      addedHigh,
			},
		})
	}
}
