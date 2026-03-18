package vulnkb

import (
	"net/http"
	"strconv"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func GetKBEntry(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		vulnID := c.Param("vulnId")
		if vulnID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "vuln_id is required"})
			return
		}
		entry := &models.VulnKBEntry{}
		if err := db.NewSelect().Model(entry).Where("vuln_id = ?", vulnID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "no KB entry found"})
			return
		}
		c.JSON(http.StatusOK, entry)
	}
}

func ListKBEntries(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		search := c.Query("q")
		severity := c.Query("severity")

		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 200 {
			limit = 50
		}
		offset := (page - 1) * limit

		base := db.NewSelect().Model((*models.VulnKBEntry)(nil))
		if search != "" {
			base = base.Where("vuln_id ILIKE ? OR description ILIKE ?", "%"+search+"%", "%"+search+"%")
		}
		if severity != "" {
			base = base.Where("severity = ?", severity)
		}

		total, err := base.Count(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count KB entries"})
			return
		}

		var entries []models.VulnKBEntry
		if err := base.OrderExpr("cvss_score DESC NULLS LAST, vuln_id").
			Limit(limit).Offset(offset).
			Scan(c.Request.Context(), &entries); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query KB"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": entries, "total": total})
	}
}
