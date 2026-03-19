package scans

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	authfuncs "justscan-backend/functions/auth"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func ListScans(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, err := authfuncs.GetUserIDFromToken(c.GetHeader("Authorization"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
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

		var scans []models.Scan
		q := db.NewSelect().Model(&scans).
			OrderExpr("created_at DESC").
			Limit(limit).
			Offset(offset)

		// Admin can see all scans; user sees only their own
		tokenType, _ := authfuncs.GetTypeFromToken(c.GetHeader("Authorization"))
		if tokenType != "admin" {
			q = q.Where("user_id = ?", userID)
		}

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
		if tags := c.Query("tags"); tags != "" {
			tagIDs := strings.Split(tags, ",")
			q = q.Where("id IN (SELECT scan_id FROM scan_tags WHERE tag_id = ANY(?))", bun.In(tagIDs))
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

		c.JSON(http.StatusOK, gin.H{
			"data":  scans,
			"total": total,
			"page":  page,
			"limit": limit,
		})
	}
}
