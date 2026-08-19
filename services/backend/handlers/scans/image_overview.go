package scans

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"justscan-backend/compliance"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// ImageOverview is the production-facing image index. The latest scan for every
// tag participates in the image's health calculation; the most concerning one is
// returned as the health scan so a newer clean tag cannot hide an older failure.
type ImageOverview struct {
	ImageName            string                      `json:"image_name"`
	ScanCount            int                         `json:"scan_count"`
	TagCount             int                         `json:"tag_count"`
	LatestScanID         string                      `json:"latest_scan_id"`
	LatestTag            string                      `json:"latest_tag"`
	LatestStatus         string                      `json:"latest_status"`
	LatestExternalStatus string                      `json:"latest_external_status,omitempty"`
	LatestScanAt         time.Time                   `json:"latest_scan_at"`
	HealthScanID         string                      `json:"health_scan_id"`
	HealthTag            string                      `json:"health_tag"`
	HealthStatus         string                      `json:"health_status"`
	HealthExternalStatus string                      `json:"health_external_status,omitempty"`
	HealthCriticalCount  int                         `json:"health_critical_count"`
	HealthHighCount      int                         `json:"health_high_count"`
	HealthMediumCount    int                         `json:"health_medium_count"`
	HealthLowCount       int                         `json:"health_low_count"`
	HealthPolicyFailed   bool                        `json:"health_policy_failed"`
	IntelligenceSummary  *models.IntelligenceSummary `json:"intelligence_summary,omitempty"`
}

func parseImageOverviewTime(c *gin.Context) (string, []interface{}) {
	clauses := make([]string, 0, 2)
	args := make([]interface{}, 0, 2)
	if raw := strings.TrimSpace(c.Query("from")); raw != "" {
		if value, err := time.Parse(time.RFC3339, raw); err == nil {
			clauses = append(clauses, "s.created_at >= ?")
			args = append(args, value)
		}
	}
	if raw := strings.TrimSpace(c.Query("to")); raw != "" {
		if value, err := time.Parse(time.RFC3339, raw); err == nil {
			clauses = append(clauses, "s.created_at <= ?")
			args = append(args, value)
		}
	}
	if len(clauses) == 0 {
		return "1=1", nil
	}
	return strings.Join(clauses, " AND "), args
}

func imageOverviewOrder(raw string) string {
	switch raw {
	case "image_asc":
		return "image_name ASC"
	case "scan_count_desc":
		return "scan_count DESC, latest_scan_at DESC"
	case "risk_desc":
		return "health_rank DESC, latest_scan_at DESC"
	default:
		return "latest_scan_at DESC"
	}
}

func ListScanImages(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}

		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "30"))
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 100 {
			limit = 30
		}
		offset := (page - 1) * limit

		userWhere, userArgs := scanOwnershipWhere(userID, isAdmin, accessibleOrgIDs, "s")
		scopeWhere, scopeArgs := scanScopeWhere(c, userID, "s")
		searchWhere := "1=1"
		searchArgs := []interface{}{}
		if query := strings.TrimSpace(c.Query("q")); query != "" {
			pattern := "%" + query + "%"
			searchWhere = `(s.image_name ILIKE ? OR s.image_tag ILIKE ? OR EXISTS (
                SELECT 1 FROM scan_tags st JOIN tags t ON t.id = st.tag_id
                WHERE st.scan_id = s.id AND t.name ILIKE ?
            ))`
			searchArgs = []interface{}{pattern, pattern, pattern}
		}
		timeWhere, timeArgs := parseImageOverviewTime(c)

		scopedOrgID, orgScoped := scopedOrgIDFromRequest(c)
		policyExpression := "false"
		policyArgs := []interface{}{}
		if orgScoped {
			policyExpression = "EXISTS (SELECT 1 FROM compliance_results cr WHERE cr.scan_id = l.scan_id AND cr.org_id = ? AND cr.status = 'fail')"
			policyArgs = append(policyArgs, scopedOrgID)
		}

		baseArgs := append([]interface{}{}, userArgs...)
		baseArgs = append(baseArgs, scopeArgs...)
		baseArgs = append(baseArgs, searchArgs...)
		baseArgs = append(baseArgs, timeArgs...)

		baseQuery := `
WITH visible AS (
    SELECT s.*
    FROM scans s
    WHERE ` + userWhere + ` AND ` + scopeWhere + ` AND ` + searchWhere + ` AND ` + timeWhere + `
), latest_by_tag AS (
    SELECT DISTINCT ON (image_name, image_tag)
        id AS scan_id, image_name, image_tag, status,
        COALESCE(external_status, '') AS external_status,
        created_at, critical_count, high_count, medium_count, low_count
    FROM visible
    ORDER BY image_name, image_tag, created_at DESC, id DESC
), tagged AS (
    SELECT l.*,
        ` + policyExpression + ` AS policy_failed,
        CASE
            WHEN l.status = 'failed' AND l.external_status = 'blocked_by_xray_policy' THEN 600
            WHEN l.status = 'failed' THEN 500
            WHEN ` + policyExpression + ` THEN 450
            WHEN l.critical_count > 0 THEN 400
            WHEN l.high_count > 0 THEN 300
            WHEN l.medium_count > 0 THEN 200
            WHEN l.low_count > 0 THEN 100
            WHEN l.status IN ('pending', 'running') THEN 50
            ELSE 0
        END AS health_rank,
        ROW_NUMBER() OVER (PARTITION BY l.image_name ORDER BY l.created_at DESC, l.scan_id DESC) AS latest_rank,
        ROW_NUMBER() OVER (PARTITION BY l.image_name ORDER BY
            CASE
                WHEN l.status = 'failed' AND l.external_status = 'blocked_by_xray_policy' THEN 600
                WHEN l.status = 'failed' THEN 500
                WHEN ` + policyExpression + ` THEN 450
                WHEN l.critical_count > 0 THEN 400
                WHEN l.high_count > 0 THEN 300
                WHEN l.medium_count > 0 THEN 200
                WHEN l.low_count > 0 THEN 100
                WHEN l.status IN ('pending', 'running') THEN 50
                ELSE 0
            END DESC, l.created_at DESC, l.scan_id DESC
        ) AS health_row
    FROM latest_by_tag l
), counts AS (
    SELECT image_name, COUNT(*) AS scan_count FROM visible GROUP BY image_name
), overview AS (
    SELECT
        h.image_name, c.scan_count,
        COUNT(*) OVER (PARTITION BY h.image_name) AS tag_count,
        MAX(h.health_rank) OVER (PARTITION BY h.image_name) AS health_rank,
        MAX(h.created_at) OVER (PARTITION BY h.image_name) AS latest_scan_at,
        MAX(h.scan_id::text) FILTER (WHERE h.latest_rank = 1) OVER (PARTITION BY h.image_name) AS latest_scan_id,
        MAX(h.image_tag) FILTER (WHERE h.latest_rank = 1) OVER (PARTITION BY h.image_name) AS latest_tag,
        MAX(h.status) FILTER (WHERE h.latest_rank = 1) OVER (PARTITION BY h.image_name) AS latest_status,
        MAX(h.external_status) FILTER (WHERE h.latest_rank = 1) OVER (PARTITION BY h.image_name) AS latest_external_status,
        h.scan_id AS health_scan_id, h.image_tag AS health_tag, h.status AS health_status,
        h.external_status AS health_external_status, h.critical_count AS health_critical_count,
        h.high_count AS health_high_count, h.medium_count AS health_medium_count,
        h.low_count AS health_low_count, h.policy_failed AS health_policy_failed,
        h.health_row
    FROM tagged h
    JOIN counts c ON c.image_name = h.image_name
)
`

		statusWhere, statusArgs := latestImageStatusWhereClause(c.Query("status"))
		statusWhere = strings.ReplaceAll(statusWhere, "latest_status", "health_status")
		statusWhere = strings.ReplaceAll(statusWhere, "latest_external_status", "health_external_status")
		criticalWhere := "1=1"
		switch strings.TrimSpace(c.Query("critical")) {
		case "yes":
			criticalWhere = "health_critical_count > 0"
		case "no":
			criticalWhere = "health_critical_count = 0"
		}
		policyWhere := "1=1"
		if c.Query("policy") == "fail" && orgScoped {
			policyWhere = "health_policy_failed = true"
		}
		intelligenceWhere := "1=1"
		var intelligenceArgs []interface{}
		if intelligence := strings.ToLower(strings.TrimSpace(c.Query("intelligence"))); intelligence != "" {
			condition, conditionArgs, supported := scanIntelligenceFilterCondition("health_scan_id", intelligence)
			if !supported {
				c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported intelligence filter"})
				return
			}
			intelligenceWhere = condition
			intelligenceArgs = conditionArgs
		}
		args := append([]interface{}{}, baseArgs...)
		// policyExpression appears three times in the CTE whenever organization policy is enabled.
		if orgScoped {
			args = append(args, policyArgs...)
			args = append(args, policyArgs...)
			args = append(args, policyArgs...)
		}
		args = append(args, statusArgs...)
		where := "health_row = 1 AND " + statusWhere + " AND " + criticalWhere + " AND " + policyWhere + " AND " + intelligenceWhere
		args = append(args, intelligenceArgs...)

		var total int
		if err := db.QueryRowContext(c.Request.Context(), baseQuery+"SELECT COUNT(*) FROM overview WHERE "+where, args...).Scan(&total); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count scan images"})
			return
		}
		dataArgs := append(append([]interface{}{}, args...), limit, offset)
		rows, err := db.QueryContext(c.Request.Context(), baseQuery+`SELECT image_name, scan_count, tag_count, latest_scan_id::text, latest_tag, latest_status, latest_external_status, latest_scan_at, health_scan_id::text, health_tag, health_status, health_external_status, health_critical_count, health_high_count, health_medium_count, health_low_count, health_policy_failed FROM overview WHERE `+where+` ORDER BY `+imageOverviewOrder(c.Query("sort"))+` LIMIT ? OFFSET ?`, dataArgs...)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan images"})
			return
		}
		defer rows.Close()
		images := make([]ImageOverview, 0)
		for rows.Next() {
			var image ImageOverview
			if err := rows.Scan(&image.ImageName, &image.ScanCount, &image.TagCount, &image.LatestScanID, &image.LatestTag, &image.LatestStatus, &image.LatestExternalStatus, &image.LatestScanAt, &image.HealthScanID, &image.HealthTag, &image.HealthStatus, &image.HealthExternalStatus, &image.HealthCriticalCount, &image.HealthHighCount, &image.HealthMediumCount, &image.HealthLowCount, &image.HealthPolicyFailed); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read scan image"})
				return
			}
			images = append(images, image)
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read scan images"})
			return
		}
		if len(images) > 0 {
			scanIDs := make([]uuid.UUID, 0, len(images))
			imageIndexByScanID := make(map[uuid.UUID]int, len(images))
			for index := range images {
				scanID, parseErr := uuid.Parse(images[index].HealthScanID)
				if parseErr != nil {
					continue
				}
				scanIDs = append(scanIDs, scanID)
				imageIndexByScanID[scanID] = index
			}
			intelligenceSummaries, summaryErr := compliance.LoadIntelligenceSummaries(
				c.Request.Context(), db, scanIDs,
			)
			if summaryErr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load image intelligence summaries"})
				return
			}
			for scanID, summary := range intelligenceSummaries {
				if index, ok := imageIndexByScanID[scanID]; ok {
					images[index].IntelligenceSummary = summary
				}
			}
		}
		c.JSON(http.StatusOK, gin.H{"data": images, "total": total, "page": page, "limit": limit})
	}
}

type ImageStats struct {
	TotalScans           int     `json:"total_scans"`
	CompletedScans       int     `json:"completed_scans"`
	FailedScans          int     `json:"failed_scans"`
	PolicyAvailable      bool    `json:"policy_available"`
	PolicyPassedScans    int     `json:"policy_passed_scans"`
	PolicyFailedScans    int     `json:"policy_failed_scans"`
	PolicyEvaluatedScans int     `json:"policy_evaluated_scans"`
	AverageDurationMS    float64 `json:"average_duration_ms"`
}

func GetScanImageStats(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		imageName := strings.TrimSpace(c.Query("image"))
		if imageName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "image is required"})
			return
		}
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}
		userWhere, userArgs := scanOwnershipWhere(userID, isAdmin, accessibleOrgIDs, "s")
		scopeWhere, scopeArgs := scanScopeWhere(c, userID, "s")
		args := append([]interface{}{}, userArgs...)
		args = append(args, scopeArgs...)
		args = append(args, imageName)
		stats := ImageStats{}
		query := `SELECT COUNT(*), COUNT(*) FILTER (WHERE s.status = 'completed'), COUNT(*) FILTER (WHERE s.status = 'failed'), COALESCE(AVG(EXTRACT(EPOCH FROM (s.completed_at - s.started_at)) * 1000) FILTER (WHERE s.started_at IS NOT NULL AND s.completed_at IS NOT NULL), 0) FROM scans s WHERE ` + userWhere + ` AND ` + scopeWhere + ` AND s.image_name = ?`
		if err := db.QueryRowContext(c.Request.Context(), query, args...).Scan(&stats.TotalScans, &stats.CompletedScans, &stats.FailedScans, &stats.AverageDurationMS); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load image statistics"})
			return
		}
		if orgID, scoped := scopedOrgIDFromRequest(c); scoped {
			stats.PolicyAvailable = true
			policyQuery := `SELECT COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM compliance_results cr WHERE cr.scan_id = s.id AND cr.org_id = ?)), COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM compliance_results cr WHERE cr.scan_id = s.id AND cr.org_id = ?) AND NOT EXISTS (SELECT 1 FROM compliance_results cr WHERE cr.scan_id = s.id AND cr.org_id = ? AND cr.status = 'fail')), COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM compliance_results cr WHERE cr.scan_id = s.id AND cr.org_id = ? AND cr.status = 'fail')) FROM scans s WHERE ` + userWhere + ` AND ` + scopeWhere + ` AND s.image_name = ?`
			// The query contains four policy placeholders, followed by the shared visibility arguments.
			policyArgs := append([]interface{}{orgID, orgID, orgID, orgID}, args...)
			if err := db.QueryRowContext(c.Request.Context(), policyQuery, policyArgs...).Scan(&stats.PolicyEvaluatedScans, &stats.PolicyPassedScans, &stats.PolicyFailedScans); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load image policy statistics"})
				return
			}
		}
		c.JSON(http.StatusOK, stats)
	}
}
