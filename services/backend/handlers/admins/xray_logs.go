package admins

import (
	"net/http"
	"strconv"
	"time"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// GetXRayRequestLogs returns a paginated list of recorded JFrog Xray API calls.
func GetXRayRequestLogs(c *gin.Context, db *bun.DB) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 500 {
		limit = 50
	}
	offset := (page - 1) * limit

	var entries []models.XRayRequestLog

	q := db.NewSelect().
		Model(&entries).
		OrderExpr("created_at DESC")

	if scanIDStr := c.Query("scan_id"); scanIDStr != "" {
		if id, err := uuid.Parse(scanIDStr); err == nil {
			q = q.Where("scan_id = ?", id)
		}
	}
	if registryIDStr := c.Query("registry_id"); registryIDStr != "" {
		if id, err := uuid.Parse(registryIDStr); err == nil {
			q = q.Where("registry_id = ?", id)
		}
	}
	if endpoint := c.Query("endpoint"); endpoint != "" {
		q = q.Where("endpoint ILIKE ?", "%"+endpoint+"%")
	}
	if status := c.Query("status"); status != "" {
		switch status {
		case "2xx":
			q = q.Where("status_code >= 200 AND status_code < 300")
		case "4xx":
			q = q.Where("status_code >= 400 AND status_code < 500")
		case "5xx":
			q = q.Where("status_code >= 500")
		case "error":
			q = q.Where("status_code >= 400 OR status_code = -1")
		default:
			if code, err := strconv.Atoi(status); err == nil {
				q = q.Where("status_code = ?", code)
			}
		}
	}
	if from := c.Query("from"); from != "" {
		if parsed, err := time.Parse(time.RFC3339, from); err == nil {
			q = q.Where("created_at >= ?", parsed)
		}
	}
	if to := c.Query("to"); to != "" {
		if parsed, err := time.Parse(time.RFC3339, to); err == nil {
			q = q.Where("created_at <= ?", parsed)
		}
	}

	total, err := q.Limit(limit).Offset(offset).ScanAndCount(c.Request.Context(), &entries)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load xray request logs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": entries, "total": total})
}
