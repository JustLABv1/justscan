package scans

import (
	"context"
	"fmt"
	"net/http"

	"justscan-backend/functions/audit"
	"justscan-backend/functions/authz"
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

		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		// Parse and validate all UUIDs first to prevent injection.
		ids := make([]uuid.UUID, 0, len(req.IDs))
		for _, raw := range req.IDs {
			id, err := uuid.Parse(raw)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID: " + raw})
				return
			}
			ids = append(ids, id)
		}

		var scans []models.Scan
		if err := db.NewSelect().Model(&scans).Where("id IN (?)", bun.In(ids)).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scans"})
			return
		}
		if len(scans) != len(ids) {
			c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
			return
		}
		for index := range scans {
			if !canWriteScan(c.Request.Context(), db, &scans[index], userID, isAdmin) {
				c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
				return
			}
		}

		if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			return deleteScanRecords(ctx, tx, ids)
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete scans"})
			return
		}
		go audit.Write(context.Background(), db, userID.String(), "scan.bulk_delete",
			fmt.Sprintf("Bulk deleted %d scans", len(ids)))

		c.JSON(http.StatusOK, gin.H{"deleted": len(ids)})
	}
}

type bulkTagRequest struct {
	IDs []string `json:"ids" binding:"required,min=1"`
}

// BulkAddTagToScans attaches a tag to multiple scans at once.
func BulkAddTagToScans(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		tagID, err := uuid.Parse(c.Param("tagId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tag ID"})
			return
		}
		tag := &models.Tag{}
		if err := db.NewSelect().Model(tag).Where("id = ?", tagID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "tag not found"})
			return
		}
		if !authz.CanReadTag(c.Request.Context(), db, tag, userID, isAdmin) {
			c.JSON(http.StatusNotFound, gin.H{"error": "tag not found"})
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
			scan := &models.Scan{}
			if err := db.NewSelect().Model(scan).Where("id = ?", id).Scan(c.Request.Context()); err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "scan not found: " + raw})
				return
			}
			if !canWriteScan(c.Request.Context(), db, scan, userID, isAdmin) {
				c.JSON(http.StatusNotFound, gin.H{"error": "scan not found: " + raw})
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
