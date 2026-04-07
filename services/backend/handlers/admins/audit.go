package admins

import (
	"net/http"
	"strconv"
	"time"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

// GetAuditLogs returns a paginated list of audit entries joined with user info.
func GetAuditLogs(c *gin.Context, db *bun.DB) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 50
	}
	offset := (page - 1) * limit

	var entries []models.AuditWithUser

	q := db.NewSelect().
		TableExpr("audit a").
		ColumnExpr("a.*, u.username, u.email, u.role").
		Join("LEFT JOIN users u ON u.id::text = a.user_id").
		OrderExpr("a.created_at DESC")

	if operation := c.Query("operation"); operation != "" {
		q = q.Where("a.operation = ?", operation)
	}
	if user := c.Query("user"); user != "" {
		pattern := "%" + user + "%"
		q = q.WhereGroup(" AND ", func(selectQuery *bun.SelectQuery) *bun.SelectQuery {
			return selectQuery.
				Where("u.username ILIKE ?", pattern).
				WhereOr("u.email ILIKE ?", pattern).
				WhereOr("a.user_id ILIKE ?", pattern)
		})
	}
	if search := c.Query("q"); search != "" {
		pattern := "%" + search + "%"
		q = q.WhereGroup(" AND ", func(selectQuery *bun.SelectQuery) *bun.SelectQuery {
			return selectQuery.
				Where("a.details ILIKE ?", pattern).
				WhereOr("a.operation ILIKE ?", pattern).
				WhereOr("u.username ILIKE ?", pattern).
				WhereOr("u.email ILIKE ?", pattern)
		})
	}
	if from := c.Query("from"); from != "" {
		if parsed, err := time.Parse(time.RFC3339, from); err == nil {
			q = q.Where("a.created_at >= ?", parsed)
		}
	}
	if to := c.Query("to"); to != "" {
		if parsed, err := time.Parse(time.RFC3339, to); err == nil {
			q = q.Where("a.created_at <= ?", parsed)
		}
	}

	total, err := q.
		Limit(limit).
		Offset(offset).
		ScanAndCount(c.Request.Context(), &entries)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load audit logs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": entries, "total": total})
}
