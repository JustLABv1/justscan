package scans

import (
	"net/http"
	"strconv"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ListVulnerabilities(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 500 {
			limit = 50
		}
		offset := (page - 1) * limit

		var vulns []models.Vulnerability
		q := db.NewSelect().Model(&vulns).
			Where("scan_id = ?", scanID).
			OrderExpr("CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END, vuln_id").
			Limit(limit).
			Offset(offset)

		// Filters
		if sev := c.Query("severity"); sev != "" {
			q = q.Where("severity = ?", sev)
		}
		if pkg := c.Query("pkg"); pkg != "" {
			q = q.Where("pkg_name ILIKE ?", "%"+pkg+"%")
		}
		if c.Query("has_fix") == "true" {
			q = q.Where("fixed_version != ''")
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

		// Get the image digest to join suppressions
		scan := &models.Scan{}
		db.NewSelect().Model(scan).Column("image_digest").Where("id = ?", scanID).Scan(c.Request.Context()) //nolint:errcheck

		// Enrich with suppressions (per image digest + vuln_id)
		if scan.ImageDigest != "" {
			var suppressions []models.Suppression
			db.NewSelect().Model(&suppressions).
				Where("image_digest = ?", scan.ImageDigest).
				Scan(c.Request.Context()) //nolint:errcheck

			suppMap := make(map[string]*models.Suppression, len(suppressions))
			for i := range suppressions {
				suppMap[suppressions[i].VulnID] = &suppressions[i]
			}
			for i := range vulns {
				if s, ok := suppMap[vulns[i].VulnID]; ok {
					vulns[i].Suppression = s
				}
			}
		}

		// Enrich with KB entries
		var kbEntries []models.VulnKBEntry
		vulnIDs := make([]string, len(vulns))
		for i, v := range vulns {
			vulnIDs[i] = v.VulnID
		}
		if len(vulnIDs) > 0 {
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

		// Load comments per vulnerability
		for i := range vulns {
			var comments []models.Comment
			db.NewSelect().Model(&comments).
				Where("vulnerability_id = ?", vulns[i].ID).
				OrderExpr("created_at ASC").
				Scan(c.Request.Context()) //nolint:errcheck
			vulns[i].Comments = comments
		}

		c.JSON(http.StatusOK, gin.H{
			"data":  vulns,
			"total": total,
			"page":  page,
			"limit": limit,
		})
	}
}
