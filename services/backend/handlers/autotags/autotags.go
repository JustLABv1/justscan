package autotags

import (
	"net/http"
	"time"

	authfuncs "justscan-backend/functions/auth"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// List returns all auto-tag rules with the Tag relation loaded.
func List(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var rules []models.AutoTagRule
		if err := db.NewSelect().
			Model(&rules).
			Relation("Tag").
			OrderExpr("created_at DESC").
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list auto-tag rules"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": rules})
	}
}

// Create creates a new auto-tag rule.
func Create(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, err := authfuncs.GetUserIDFromToken(c.GetHeader("Authorization"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		var body struct {
			Pattern string    `json:"pattern"`
			TagID   uuid.UUID `json:"tag_id"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if body.Pattern == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "pattern is required"})
			return
		}
		if body.TagID == uuid.Nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "tag_id is required"})
			return
		}

		rule := &models.AutoTagRule{
			Pattern:     body.Pattern,
			TagID:       body.TagID,
			CreatedByID: userID,
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
		if _, err := db.NewInsert().Model(rule).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create auto-tag rule"})
			return
		}

		// Load the tag relation
		db.NewSelect().
			Model(rule).
			Relation("Tag").
			Where("auto_tag_rule.id = ?", rule.ID).
			Scan(c.Request.Context()) //nolint:errcheck

		c.JSON(http.StatusCreated, rule)
	}
}

// Update updates an existing auto-tag rule.
func Update(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ruleID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule ID"})
			return
		}

		var body struct {
			Pattern string    `json:"pattern"`
			TagID   uuid.UUID `json:"tag_id"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		rule := &models.AutoTagRule{}
		if err := db.NewSelect().Model(rule).Where("id = ?", ruleID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
			return
		}

		if body.Pattern != "" {
			rule.Pattern = body.Pattern
		}
		if body.TagID != uuid.Nil {
			rule.TagID = body.TagID
		}
		rule.UpdatedAt = time.Now()

		if _, err := db.NewUpdate().Model(rule).
			Column("pattern", "tag_id", "updated_at").
			Where("id = ?", ruleID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update auto-tag rule"})
			return
		}

		// Load the tag relation
		db.NewSelect().
			Model(rule).
			Relation("Tag").
			Where("auto_tag_rule.id = ?", rule.ID).
			Scan(c.Request.Context()) //nolint:errcheck

		c.JSON(http.StatusOK, rule)
	}
}

// Delete deletes an auto-tag rule.
func Delete(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ruleID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule ID"})
			return
		}

		if _, err := db.NewDelete().Model((*models.AutoTagRule)(nil)).
			Where("id = ?", ruleID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete auto-tag rule"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "success"})
	}
}
