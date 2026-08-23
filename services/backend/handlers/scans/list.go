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

func ListScans(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}

		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 100 {
			limit = 20
		}
		offset := (page - 1) * limit

		scans := make([]models.Scan, 0)
		q := db.NewSelect().Model(&scans).
			OrderExpr("CASE WHEN status IN ('pending', 'queued', 'running') THEN 0 ELSE 1 END, created_at DESC, id DESC").
			Limit(limit).
			Offset(offset)
		q = authz.ApplyOwnershipVisibility(q, "scan", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
		q = authz.ApplyWorkspaceScope(c, q, "scan", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)

		// Filters
		if status := c.Query("status"); status != "" {
			q = q.Where("status = ?", status)
		}
		if image := c.Query("image"); image != "" {
			if c.Query("exact") == "true" {
				q = q.Where("image_name = ?", image)
			} else {
				q = q.Where("image_name ILIKE ?", "%"+image+"%")
			}
		}
		if imageTag := c.Query("image_tag"); imageTag != "" {
			q = q.Where("image_tag = ?", imageTag)
		}
		if query := strings.TrimSpace(c.Query("q")); query != "" {
			pattern := "%" + query + "%"
			q = q.Where(
				`(
                    image_name ILIKE ?
                    OR image_tag ILIKE ?
                    OR (image_name || ':' || image_tag) ILIKE ?
                    OR EXISTS (
                        SELECT 1
                        FROM scan_tags AS st
                        JOIN tags AS t ON t.id = st.tag_id
                        WHERE st.scan_id = scan.id AND t.name ILIKE ?
                    )
                )`,
				pattern,
				pattern,
				pattern,
				pattern,
			)
		}
		if tags := c.Query("tags"); tags != "" {
			tagIDs := strings.Split(tags, ",")
			q = q.Where("id IN (SELECT scan_id FROM scan_tags WHERE tag_id = ANY(?))", bun.In(tagIDs))
		}
		if c.Query("helm_only") == "true" {
			q = q.Where("helm_chart != ''")
		}
		if helmChart := c.Query("helm_chart"); helmChart != "" {
			q = q.Where("helm_chart = ?", helmChart)
		}
		if from := c.Query("from"); from != "" {
			if t, err := time.Parse(time.RFC3339, from); err == nil {
				q = q.Where("created_at >= ?", t)
			}
		}
		if to := c.Query("to"); to != "" {
			if t, err := time.Parse(time.RFC3339, to); err == nil {
				q = q.Where("created_at <= ?", t)
			}
		}
		if intelligence := strings.ToLower(strings.TrimSpace(c.Query("intelligence"))); intelligence != "" {
			condition, conditionArgs, supported := scanIntelligenceFilterCondition("scan.id", intelligence)
			if !supported {
				c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported intelligence filter"})
				return
			}
			q = q.Where(condition, conditionArgs...)
		}

		total, err := q.Count(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count scans"})
			return
		}

		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list scans"})
			return
		}

		// Load tags for each scan
		for i := range scans {
			var tags []models.Tag
			db.NewSelect().
				TableExpr("tags AS t").
				ColumnExpr("t.*").
				Join("JOIN scan_tags st ON st.tag_id = t.id").
				Where("st.scan_id = ?", scans[i].ID).
				Scan(c.Request.Context(), &tags) //nolint:errcheck
			scans[i].Tags = tags
		}
		if err := attachPipelineInitiators(c.Request.Context(), db, scans); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan initiators"})
			return
		}
		if len(scans) > 0 {
			scanIDs := make([]uuid.UUID, 0, len(scans))
			for _, scan := range scans {
				scanIDs = append(scanIDs, scan.ID)
			}
			summaries, summaryErr := compliance.LoadIntelligenceSummaries(c.Request.Context(), db, scanIDs)
			if summaryErr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan intelligence summaries"})
				return
			}
			for i := range scans {
				scans[i].IntelligenceSummary = summaries[scans[i].ID]
			}
		}

		if scopedOrgID, scoped := scopedOrgIDFromRequest(c); scoped {
			scanIDs := make([]uuid.UUID, 0, len(scans))
			for _, scan := range scans {
				scanIDs = append(scanIDs, scan.ID)
			}
			summaries, summaryErr := buildScanComplianceSummaries(c.Request.Context(), db, scanIDs, scopedOrgID)
			if summaryErr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan compliance summaries"})
				return
			}
			for i := range scans {
				scans[i].ComplianceSummary = summaries[scans[i].ID]
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"data":  scans,
			"total": total,
			"page":  page,
			"limit": limit,
		})
	}
}
