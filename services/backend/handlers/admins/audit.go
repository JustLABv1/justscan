package admins

import (
	"net/http"
	"strconv"

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

	total, err := db.NewSelect().
		TableExpr("audit a").
		ColumnExpr("a.*, u.username, u.email, u.role").
		Join("LEFT JOIN users u ON u.id::text = a.user_id").
		OrderExpr("a.created_at DESC").
		Limit(limit).
		Offset(offset).
		ScanAndCount(c.Request.Context(), &entries)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load audit logs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": entries, "total": total})
}
