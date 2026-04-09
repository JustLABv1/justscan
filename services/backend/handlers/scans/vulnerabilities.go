package scans

import (
	"net/http"
	"strconv"
	"time"

	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// VulnerabilityResponse embeds Vulnerability and adds the FirstSeenAt field.
type VulnerabilityResponse struct {
	models.Vulnerability
	FirstSeenAt *time.Time `json:"first_seen_at"`
}

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

		scan, _, _, ok := LoadAuthorizedScan(c, db, scanID)
		if !ok {
			return
		}
		if _, err := scanner.EnsureScanImageDigest(c.Request.Context(), db, scan); err != nil {
			// Leave the response usable even if digest backfill is unavailable.
		}

		// Sorting
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
			Where("scan_id = ?", scanID).
			OrderExpr(orderExpr).
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

		// Batch-query first_seen_at for each vuln_id+pkg_name combination across
		// all OTHER completed scans of the same image. Excluding the current scan
		// means: if first_seen_at is non-null, the vulnerability existed before this
		// scan; if it is null, this is the first time we have ever seen it.
		type firstSeenRow struct {
			VulnID      string     `bun:"vuln_id"`
			PkgName     string     `bun:"pkg_name"`
			FirstSeenAt *time.Time `bun:"first_seen_at"`
		}
		var firstSeenRows []firstSeenRow
		db.NewRaw(`
			SELECT v.vuln_id, v.pkg_name, MIN(s.completed_at) AS first_seen_at
			FROM vulnerabilities v
			JOIN scans s ON s.id = v.scan_id
			WHERE s.image_name = (SELECT image_name FROM scans WHERE id = ?)
			  AND s.status = 'completed'
			  AND s.id != ?
			GROUP BY v.vuln_id, v.pkg_name
		`, scanID, scanID).Scan(c.Request.Context(), &firstSeenRows) //nolint:errcheck

		firstSeenMap := make(map[string]*time.Time, len(firstSeenRows))
		for i := range firstSeenRows {
			key := firstSeenRows[i].VulnID + "|" + firstSeenRows[i].PkgName
			firstSeenMap[key] = firstSeenRows[i].FirstSeenAt
		}

		// Build response with first_seen_at merged in
		response := make([]VulnerabilityResponse, len(vulns))
		for i, v := range vulns {
			key := v.VulnID + "|" + v.PkgName
			response[i] = VulnerabilityResponse{
				Vulnerability: v,
				FirstSeenAt:   firstSeenMap[key],
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"data":  response,
			"total": total,
			"page":  page,
			"limit": limit,
		})
	}
}
