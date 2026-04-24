package autotags

import (
	"net/http"
	"time"

	authfuncs "justscan-backend/functions/auth"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// List returns all auto-tag rules with the Tag relation loaded.
func List(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		var rules []models.AutoTagRule
		query := db.NewSelect().
			Model(&rules).
			Join("JOIN tags AS tag ON tag.id = auto_tag_rule.tag_id").
			Relation("Tag").
			OrderExpr("auto_tag_rule.created_at DESC")
		if !isAdmin {
			roles, err := authz.LoadUserOrgRoles(c.Request.Context(), db, userID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve organization access"})
				return
			}
			manageableOrgIDs := make([]uuid.UUID, 0, len(roles))
			for orgID, role := range roles {
				if authz.HasOrgRoleAtLeast(roles, orgID, models.OrgRoleAdmin) && role != "" {
					manageableOrgIDs = append(manageableOrgIDs, orgID)
				}
			}
			query = query.WhereGroup(" AND ", func(q *bun.SelectQuery) *bun.SelectQuery {
				q = q.Where("tag.owner_user_id = ?", userID)
				if len(manageableOrgIDs) > 0 {
					q = q.WhereOr("tag.owner_org_id IN (?)", bun.In(manageableOrgIDs))
				}
				return q
			})
		}
		if err := query.Scan(c.Request.Context()); err != nil {
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

		tag := &models.Tag{}
		if err := db.NewSelect().Model(tag).Where("id = ?", body.TagID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "tag not found"})
			return
		}
		if !authz.CanManageTag(c.Request.Context(), db, tag, userID, false) {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
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
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

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

		tag := &models.Tag{}
		if err := db.NewSelect().Model(tag).Where("id = ?", rule.TagID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "tag not found"})
			return
		}
		if !authz.CanManageTag(c.Request.Context(), db, tag, userID, isAdmin) {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
			return
		}

		if body.Pattern != "" {
			rule.Pattern = body.Pattern
		}
		if body.TagID != uuid.Nil {
			nextTag := &models.Tag{}
			if err := db.NewSelect().Model(nextTag).Where("id = ?", body.TagID).Scan(c.Request.Context()); err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "tag not found"})
				return
			}
			if !authz.CanManageTag(c.Request.Context(), db, nextTag, userID, isAdmin) {
				c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
				return
			}
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
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		ruleID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule ID"})
			return
		}

		rule := &models.AutoTagRule{}
		if err := db.NewSelect().Model(rule).Where("id = ?", ruleID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
			return
		}
		tag := &models.Tag{}
		if err := db.NewSelect().Model(tag).Where("id = ?", rule.TagID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "tag not found"})
			return
		}
		if !authz.CanManageTag(c.Request.Context(), db, tag, userID, isAdmin) {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
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
