package scans

import (
	"net/http"
	"strconv"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// ListScanXRayRequestLogs returns per-scan Xray request logs for authorized scan viewers.
func ListScanXRayRequestLogs(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		if _, _, _, ok := LoadAuthorizedScan(c, db, scanID); !ok {
			return
		}

		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200"))
		if limit < 1 {
			limit = 200
		}
		if limit > 1000 {
			limit = 1000
		}

		entries := make([]models.XRayRequestLog, 0)
		if err := db.NewSelect().
			Model(&entries).
			Where("scan_id = ?", scanID).
			OrderExpr("created_at ASC").
			Limit(limit).
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load xray request logs"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": entries})
	}
}
