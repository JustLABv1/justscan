package tags

import (
	"net/http"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ListTags(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var tags []models.Tag
		if err := db.NewSelect().Model(&tags).OrderExpr("name ASC").Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list tags"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": tags})
	}
}

func CreateTag(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Name  string `json:"name" binding:"required"`
			Color string `json:"color"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if body.Color == "" {
			body.Color = "#6366f1"
		}
		tag := &models.Tag{Name: body.Name, Color: body.Color}
		if _, err := db.NewInsert().Model(tag).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": "tag name already exists"})
			return
		}
		c.JSON(http.StatusCreated, tag)
	}
}

func UpdateTag(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tagID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tag ID"})
			return
		}
		var body struct {
			Name  string `json:"name"`
			Color string `json:"color"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		tag := &models.Tag{}
		if err := db.NewSelect().Model(tag).Where("id = ?", tagID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "tag not found"})
			return
		}
		if body.Name != "" {
			tag.Name = body.Name
		}
		if body.Color != "" {
			tag.Color = body.Color
		}
		if _, err := db.NewUpdate().Model(tag).Column("name", "color").Where("id = ?", tagID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update tag"})
			return
		}
		c.JSON(http.StatusOK, tag)
	}
}

func DeleteTag(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tagID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tag ID"})
			return
		}
		if _, err := db.NewDelete().Model((*models.Tag)(nil)).Where("id = ?", tagID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete tag"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}

func AddTagToScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		tagID, err := uuid.Parse(c.Param("tagId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tag ID"})
			return
		}
		scanTag := &models.ScanTag{ScanID: scanID, TagID: tagID}
		if _, err := db.NewInsert().Model(scanTag).On("CONFLICT DO NOTHING").Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add tag"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "added"})
	}
}

func RemoveTagFromScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		tagID, err := uuid.Parse(c.Param("tagId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tag ID"})
			return
		}
		if _, err := db.NewDelete().Model((*models.ScanTag)(nil)).
			Where("scan_id = ? AND tag_id = ?", scanID, tagID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove tag"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "removed"})
	}
}
