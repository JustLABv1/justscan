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
