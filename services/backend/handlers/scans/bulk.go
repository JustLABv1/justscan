package scans

import (
	"fmt"
	"net/http"

	"justscan-backend/functions/audit"
	"justscan-backend/functions/auth"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type bulkDeleteRequest struct {
	IDs []string `json:"ids" binding:"required,min=1"`
}

// BulkDeleteScans deletes multiple scans by ID.
func BulkDeleteScans(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req bulkDeleteRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		// Parse and validate all UUIDs first to prevent injection
		ids := make([]interface{}, 0, len(req.IDs))
		for _, raw := range req.IDs {
			id, err := uuid.Parse(raw)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID: " + raw})
				return
			}
			ids = append(ids, id)
		}

		res, err := db.NewDelete().
			Model((*models.Scan)(nil)).
			Where("id IN (?)", bun.In(ids)).
			Exec(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete scans"})
			return
		}

		affected, _ := res.RowsAffected()

		userID, _ := auth.GetUserIDFromToken(c.GetHeader("Authorization"))
		go audit.Write(c.Request.Context(), db, userID.String(), "scan.bulk_delete",
			fmt.Sprintf("Bulk deleted %d scans", affected))

		c.JSON(http.StatusOK, gin.H{"deleted": affected})
	}
}

type bulkTagRequest struct {
	IDs []string `json:"ids" binding:"required,min=1"`
}

// BulkAddTagToScans attaches a tag to multiple scans at once.
func BulkAddTagToScans(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tagID, err := uuid.Parse(c.Param("tagId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tag ID"})
			return
		}

		var req bulkTagRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		var scanTags []models.ScanTag
		for _, raw := range req.IDs {
			id, err := uuid.Parse(raw)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID: " + raw})
				return
			}
			scanTags = append(scanTags, models.ScanTag{ScanID: id, TagID: tagID})
		}

		_, err = db.NewInsert().Model(&scanTags).On("CONFLICT DO NOTHING").Exec(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to attach tag"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "success", "count": len(scanTags)})
	}
}
