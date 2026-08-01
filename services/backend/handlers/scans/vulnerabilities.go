package scans

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	effectivesuppressions "justscan-backend/functions/suppressions"
	"justscan-backend/functions/vulnerabilityview"
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

type VulnerabilitySummary struct {
	Critical            int `json:"critical"`
	High                int `json:"high"`
	Medium              int `json:"medium"`
	Low                 int `json:"low"`
	WithFix             int `json:"with_fix"`
	XrayPolicy          int `json:"xray_policy"`
	IntelligenceChanged int `json:"intelligence_changed"`
	IntelligenceRescan  int `json:"intelligence_needs_rescan"`
	IntelligenceFix     int `json:"intelligence_fix_available"`
}

func applyVulnerabilityFilters(c *gin.Context, q *bun.SelectQuery) *bun.SelectQuery {
	if sev := c.Query("severity"); sev != "" {
		parts := strings.Split(sev, ",")
		values := make([]string, 0, len(parts))
		for _, part := range parts {
			trimmed := strings.ToUpper(strings.TrimSpace(part))
			if trimmed != "" {
				values = append(values, trimmed)
			}
		}
		switch len(values) {
		case 0:
		case 1:
			q = q.Where("v.severity = ?", values[0])
		default:
			q = q.Where("v.severity IN (?)", bun.In(values))
		}
	}
	if pkg := c.Query("pkg"); pkg != "" {
		q = q.Where("v.pkg_name ILIKE ?", "%"+pkg+"%")
	}
	if c.Query("has_fix") == "true" {
		q = q.Where("v.fixed_version != ''")
	}
	if minCVSS := c.Query("min_cvss"); minCVSS != "" {
		q = q.Where("v.cvss_score >= ?", minCVSS)
	}
	if intelligence := strings.ToLower(strings.TrimSpace(c.Query("intelligence"))); intelligence != "" {
		q = applyIntelligenceFilter(q, intelligence)
	}
	return q
}

func validateIntelligenceFilter(c *gin.Context) bool {
	filter := strings.ToLower(strings.TrimSpace(c.Query("intelligence")))
	if filter == "" {
		return true
	}
	if _, _, ok := intelligenceFilterCondition(filter); ok {
		return true
	}
	c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported intelligence filter"})
	return false
}

func applyIntelligenceFilter(q *bun.SelectQuery, filter string) *bun.SelectQuery {
	condition, args, ok := intelligenceFilterCondition(filter)
	if !ok {
		return q
	}
	return q.Where(condition, args...)
}

func intelligenceFilterCondition(filter string) (string, []interface{}, bool) {
	switch filter {
	case "changed":
		return "EXISTS (SELECT 1 FROM vulnerability_postures p WHERE p.finding_id = v.id AND p.state IS NOT NULL AND p.state <> ?)", []interface{}{models.PostureStateUnchanged}, true
	case models.PostureStateNeedsRescan:
		return "EXISTS (SELECT 1 FROM vulnerability_postures p WHERE p.finding_id = v.id AND p.state = ?)", []interface{}{models.PostureStateNeedsRescan}, true
	case models.PostureStateFixAvailable:
		return "EXISTS (SELECT 1 FROM vulnerability_postures p WHERE p.finding_id = v.id AND p.state = ?)", []interface{}{models.PostureStateFixAvailable}, true
	case models.PostureStateNotAffected:
		return "EXISTS (SELECT 1 FROM vulnerability_postures p WHERE p.finding_id = v.id AND p.state = ?)", []interface{}{models.PostureStateNotAffected}, true
	case "disputed_rejected":
		return "EXISTS (SELECT 1 FROM vulnerability_postures p WHERE p.finding_id = v.id AND p.state IN (?))", []interface{}{bun.In([]string{models.PostureStateDisputed, models.PostureStateRejected})}, true
	default:
		return "", nil, false
	}
}

func ListVulnerabilities(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !validateIntelligenceFilter(c) {
			return
		}
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
		if scan.Status == models.ScanStatusCompleted {
			if _, err := scanner.EnsureScanImageDigest(c.Request.Context(), db, scan); err != nil {
				// Leave the response usable even if digest backfill is unavailable.
			}
		}

		orderExpr := vulnerabilityview.OrderExpr(c.Query("sort_by"), c.Query("sort_dir"))

		var vulns []models.Vulnerability
		q := db.NewSelect().
			TableExpr("vulnerabilities AS v").
			ColumnExpr("v.*").
			Where("v.scan_id = ?", scanID).
			OrderExpr(orderExpr).
			Limit(limit).
			Offset(offset)

		q = applyVulnerabilityFilters(c, q)

		total, err := q.Count(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count vulnerabilities"})
			return
		}

		if err := q.Scan(c.Request.Context(), &vulns); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list vulnerabilities"})
			return
		}

		if _, err := effectivesuppressions.ApplyEffectiveSuppressions(c.Request.Context(), db, scan, vulns); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve suppressions"})
			return
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
		if err := scanner.AttachVulnerabilityIntelligence(c.Request.Context(), db, vulns); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load vulnerability intelligence"})
			return
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

func GetVulnerabilitySummary(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !validateIntelligenceFilter(c) {
			return
		}
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		if _, _, _, ok := LoadAuthorizedScan(c, db, scanID); !ok {
			return
		}

		baseQuery := db.NewSelect().
			TableExpr("vulnerabilities AS v").
			Where("v.scan_id = ?", scanID)
		baseQuery = applyVulnerabilityFilters(c, baseQuery)

		var summary VulnerabilitySummary
		if err := baseQuery.
			ColumnExpr("COUNT(*) FILTER (WHERE v.severity = 'CRITICAL') AS critical").
			ColumnExpr("COUNT(*) FILTER (WHERE v.severity = 'HIGH') AS high").
			ColumnExpr("COUNT(*) FILTER (WHERE v.severity = 'MEDIUM') AS medium").
			ColumnExpr("COUNT(*) FILTER (WHERE v.severity = 'LOW') AS low").
			ColumnExpr("COUNT(*) FILTER (WHERE v.fixed_version != '') AS with_fix").
			ColumnExpr(`COUNT(*) FILTER (
				WHERE v.xray_is_blocking = true
					OR COALESCE(v.xray_watch_name, '') != ''
					OR COALESCE(jsonb_array_length(v.xray_watch_names), 0) > 0
					OR COALESCE(jsonb_array_length(v.xray_watch_policy_matches), 0) > 0
			) AS xray_policy`).
			ColumnExpr("COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM vulnerability_postures p WHERE p.finding_id = v.id AND p.state IS NOT NULL AND p.state <> ?)) AS intelligence_changed", models.PostureStateUnchanged).
			ColumnExpr("COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM vulnerability_postures p WHERE p.finding_id = v.id AND p.state = ?)) AS intelligence_needs_rescan", models.PostureStateNeedsRescan).
			ColumnExpr("COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM vulnerability_postures p WHERE p.finding_id = v.id AND p.state = ?)) AS intelligence_fix_available", models.PostureStateFixAvailable).
			Scan(c.Request.Context(), &summary); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to summarize vulnerabilities"})
			return
		}

		c.JSON(http.StatusOK, summary)
	}
}
