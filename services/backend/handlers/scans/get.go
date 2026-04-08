package scans

import (
	"net/http"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func GetScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		scan, _, _, ok := LoadAuthorizedScan(c, db, scanID)
		if !ok {
			return
		}

		// Load tags
		var tags []models.Tag
		db.NewSelect().
			TableExpr("tags AS t").
			ColumnExpr("t.*").
			Join("JOIN scan_tags st ON st.tag_id = t.id").
			Where("st.scan_id = ?", scanID).
			Scan(c.Request.Context(), &tags) //nolint:errcheck
		scan.Tags = tags

		var stepLogs []models.ScanStepLog
		db.NewSelect().
			Model(&stepLogs).
			Where("scan_id = ?", scanID).
			OrderExpr("position ASC").
			Scan(c.Request.Context()) //nolint:errcheck
		scan.StepLogs = stepLogs

		c.JSON(http.StatusOK, scan)
	}
}

func DeleteScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		if _, _, _, ok := LoadAuthorizedScan(c, db, scanID); !ok {
			return
		}

		ctx := c.Request.Context()

		// Cascade delete related data
		db.NewDelete().TableExpr("comments").Where("scan_id = ?", scanID).Exec(ctx)        //nolint:errcheck
		db.NewDelete().TableExpr("vulnerabilities").Where("scan_id = ?", scanID).Exec(ctx) //nolint:errcheck
		db.NewDelete().TableExpr("sbom_components").Where("scan_id = ?", scanID).Exec(ctx) //nolint:errcheck
		db.NewDelete().TableExpr("scan_tags").Where("scan_id = ?", scanID).Exec(ctx)       //nolint:errcheck

		if _, err := db.NewDelete().Model((*models.Scan)(nil)).Where("id = ?", scanID).Exec(ctx); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete scan"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}
