package vulnkb

import (
	"net/http"

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
		q := db.NewSelect().Model((*models.VulnKBEntry)(nil)).
			OrderExpr("published_date DESC").
			Limit(50)
		if search != "" {
			q = q.Where("vuln_id ILIKE ? OR description ILIKE ?", "%"+search+"%", "%"+search+"%")
		}
		if severity != "" {
			q = q.Where("severity = ?", severity)
		}
		var entries []models.VulnKBEntry
		if err := q.Scan(c.Request.Context(), &entries); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query KB"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": entries})
	}
}
