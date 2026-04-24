package orgs

import (
	"net/http"
	"strconv"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ListOrgAuditLog(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin); !ok {
			return
		}

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
		q := db.NewSelect().Model(&entries).
			ColumnExpr("audit.*, u.username, u.email, u.role").
			Join("LEFT JOIN users u ON u.id::text = audit.user_id").
			Where("audit.org_id = ?", orgID).
			OrderExpr("audit.created_at DESC").
			Limit(limit).
			Offset(offset)

		total, err := q.Count(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count audit entries"})
			return
		}

		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list audit log"})
			return
		}
		if entries == nil {
			entries = []models.AuditWithUser{}
		}

		c.JSON(http.StatusOK, gin.H{"data": entries, "total": total})
	}
}
