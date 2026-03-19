package shared

import (
	"net/http"
	"strconv"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

// ListSharedVulnerabilities returns filtered/sorted vulnerabilities for a shared scan.
func ListSharedVulnerabilities(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scan := getScanByShareToken(c, db)
		if scan == nil {
			return
		}

		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "25"))
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 500 {
			limit = 25
		}
		offset := (page - 1) * limit

		allowedCols := map[string]string{
			"vuln_id":           "vuln_id",
			"pkg_name":          "pkg_name",
			"severity":          "CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END",
			"cvss_score":        "cvss_score",
			"installed_version": "installed_version",
			"fixed_version":     "fixed_version",
		}
		sortCol := "severity"
		sortDir := "asc"
		if s := c.Query("sort_by"); s != "" {
			if _, ok := allowedCols[s]; ok {
				sortCol = s
			}
		}
		if d := c.Query("sort_dir"); d == "desc" {
			sortDir = "desc"
		}
		orderExpr := allowedCols[sortCol] + " " + sortDir
		if sortCol != "vuln_id" {
			orderExpr += ", vuln_id asc"
		}

		var vulns []models.Vulnerability
		q := db.NewSelect().Model(&vulns).
			Where("scan_id = ?", scan.ID).
			OrderExpr(orderExpr).
			Limit(limit).
			Offset(offset)

		if sev := c.Query("severity"); sev != "" {
			q = q.Where("severity = ?", sev)
		}
		if pkg := c.Query("pkg"); pkg != "" {
			q = q.Where("pkg_name ILIKE ?", "%"+pkg+"%")
		}
		if c.Query("has_fix") == "true" {
			q = q.Where("fixed_version != ''")
		}
		if minCVSS := c.Query("min_cvss"); minCVSS != "" {
			q = q.Where("cvss_score >= ?", minCVSS)
		}

		total, err := q.Count(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count vulnerabilities"})
			return
		}

		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list vulnerabilities"})
			return
		}

		// Enrich with VulnKB entries
		vulnIDs := make([]string, len(vulns))
		for i, v := range vulns {
			vulnIDs[i] = v.VulnID
		}
		if len(vulnIDs) > 0 {
			var kbEntries []models.VulnKBEntry
			db.NewSelect().Model(&kbEntries).Where("vuln_id IN (?)", bun.In(vulnIDs)).Scan(c.Request.Context()) //nolint:errcheck
			kbMap := make(map[string]*models.VulnKBEntry, len(kbEntries))
			for i := range kbEntries {
				kbMap[kbEntries[i].VulnID] = &kbEntries[i]
			}
			for i := range vulns {
				if kb, ok := kbMap[vulns[i].VulnID]; ok {
					vulns[i].KBEntry = kb
				}
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"data":  vulns,
			"total": total,
			"page":  page,
			"limit": limit,
		})
	}
}
