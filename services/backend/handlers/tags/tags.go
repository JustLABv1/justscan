package tags

import (
	"context"
	"net/http"
	"strings"

	"justscan-backend/functions/authz"
	scanhandlers "justscan-backend/handlers/scans"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ListTags(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}

		var tags []models.Tag
		query := db.NewSelect().Model(&tags).OrderExpr("tag.name ASC")
		if !isAdmin {
			query = query.WhereGroup(" AND ", func(q *bun.SelectQuery) *bun.SelectQuery {
				q = q.Where("tag.owner_type = ?", models.OwnerTypeSystem)
				q = q.WhereOr("tag.owner_user_id = ?", userID)
				if len(accessibleOrgIDs) > 0 {
					q = q.WhereOr("tag.owner_org_id IN (?)", bun.In(accessibleOrgIDs))
					q = q.WhereOr("EXISTS (SELECT 1 FROM org_tags shared WHERE shared.tag_id = tag.id AND shared.org_id IN (?))", bun.In(accessibleOrgIDs))
				}
				return q
			})
		}
		query = authz.ApplyWorkspaceScope(c, query, "tag", "owner_user_id", "owner_org_id", "org_tags", "tag_id", userID)
		if err := query.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list tags"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": tags})
	}
}

func CreateTag(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		var body struct {
			Name  string `json:"name" binding:"required"`
			Color string `json:"color"`
			OrgID string `json:"org_id"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		body.Name = strings.TrimSpace(body.Name)
		if body.Name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
			return
		}
		if body.Color == "" {
			body.Color = "#6366f1"
		}

		tag := &models.Tag{Name: body.Name, Color: body.Color, OwnerType: models.OwnerTypeUser, OwnerUserID: &userID}
		if orgID, hasOrg, ok := parseTagMutationOrg(c, db, body.OrgID); !ok {
			return
		} else if hasOrg {
			tag.OwnerType = models.OwnerTypeOrg
			tag.OwnerUserID = nil
			tag.OwnerOrgID = &orgID
		}

		if _, err := db.NewInsert().Model(tag).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": "tag name already exists"})
			return
		}
		if tag.OwnerOrgID != nil {
			if err := ensureOrgTagLink(c.Request.Context(), db, *tag.OwnerOrgID, tag.ID); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scope tag"})
				return
			}
		}
		c.JSON(http.StatusCreated, tag)
	}
}

func UpdateTag(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		tag, ok := loadManageableTag(c, db, userID, isAdmin)
		if !ok {
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
		if body.Name != "" {
			tag.Name = strings.TrimSpace(body.Name)
		}
		if body.Color != "" {
			tag.Color = body.Color
		}
		if _, err := db.NewUpdate().Model(tag).Column("name", "color").Where("id = ?", tag.ID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update tag"})
			return
		}
		c.JSON(http.StatusOK, tag)
	}
}

func DeleteTag(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		tag, ok := loadManageableTag(c, db, userID, isAdmin)
		if !ok {
			return
		}
		if _, err := db.NewDelete().Model((*models.Tag)(nil)).Where("id = ?", tag.ID).Exec(c.Request.Context()); err != nil {
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
		_, userID, isAdmin, ok := scanhandlers.LoadAuthorizedScanForWrite(c, db, scanID)
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
		scanTag := &models.ScanTag{ScanID: scanID, TagID: tagID}
		if _, err := db.NewInsert().Model(scanTag).On("CONFLICT DO NOTHING").Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add tag"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "added"})
	}
}

type tagShare struct {
	OrgID          uuid.UUID `bun:"org_id" json:"org_id"`
	OrgName        string    `bun:"org_name" json:"org_name"`
	OrgDescription string    `bun:"org_description" json:"org_description"`
	IsOwner        bool      `bun:"-" json:"is_owner"`
}

func ListTagShares(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tag, _, _, ok := loadTagForShareManagement(c, db)
		if !ok {
			return
		}

		var shares []tagShare
		if err := db.NewSelect().
			TableExpr("org_tags AS org_tag").
			ColumnExpr("o.id AS org_id").
			ColumnExpr("o.name AS org_name").
			ColumnExpr("o.description AS org_description").
			Join("JOIN orgs AS o ON o.id = org_tag.org_id").
			Where("org_tag.tag_id = ?", tag.ID).
			OrderExpr("o.name ASC").
			Scan(c.Request.Context(), &shares); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list tag shares"})
			return
		}

		for index := range shares {
			shares[index].IsOwner = tag.OwnerOrgID != nil && shares[index].OrgID == *tag.OwnerOrgID
		}

		c.JSON(http.StatusOK, gin.H{"data": shares})
	}
}

func ShareTag(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tag, _, isAdmin, ok := loadTagForShareManagement(c, db)
		if !ok {
			return
		}
		if tag.OwnerType == models.OwnerTypeSystem {
			c.JSON(http.StatusBadRequest, gin.H{"error": "system tags are already globally available"})
			return
		}

		var body struct {
			OrgID string `json:"org_id" binding:"required"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		targetOrgID, err := uuid.Parse(body.OrgID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
			return
		}
		if tag.OwnerOrgID != nil && *tag.OwnerOrgID == targetOrgID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "resource is already owned by that organization"})
			return
		}
		if !isAdmin {
			if _, _, _, _, ok := authz.RequireOrgRole(c, db, targetOrgID, models.OrgRoleEditor); !ok {
				return
			}
		}

		if err := ensureOrgTagLink(c.Request.Context(), db, targetOrgID, tag.ID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to share tag"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"result": "shared"})
	}
}

func UnshareTag(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tag, _, _, ok := loadTagForShareManagement(c, db)
		if !ok {
			return
		}

		targetOrgID, err := uuid.Parse(c.Param("orgId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
			return
		}
		if tag.OwnerOrgID != nil && *tag.OwnerOrgID == targetOrgID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot remove the owner organization"})
			return
		}

		if _, err := db.NewDelete().Model((*models.OrgTag)(nil)).
			Where("org_id = ?", targetOrgID).
			Where("tag_id = ?", tag.ID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke tag share"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "unshared"})
	}
}

func ensureOrgTagLink(ctx context.Context, db bun.IDB, orgID, tagID uuid.UUID) error {
	_, err := db.NewInsert().Model(&models.OrgTag{OrgID: orgID, TagID: tagID}).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}

func parseTagMutationOrg(c *gin.Context, db *bun.DB, rawOrgID string) (uuid.UUID, bool, bool) {
	rawOrgID = strings.TrimSpace(rawOrgID)
	if rawOrgID == "" {
		return uuid.Nil, false, true
	}

	orgID, err := uuid.Parse(rawOrgID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
		return uuid.Nil, false, false
	}
	if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleEditor); !ok {
		return uuid.Nil, false, false
	}

	return orgID, true, true
}

func loadManageableTag(c *gin.Context, db *bun.DB, userID uuid.UUID, isAdmin bool) (*models.Tag, bool) {
	tagID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tag ID"})
		return nil, false
	}

	tag := &models.Tag{}
	if err := db.NewSelect().Model(tag).Where("id = ?", tagID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "tag not found"})
		return nil, false
	}
	if !authz.CanManageTag(c.Request.Context(), db, tag, userID, isAdmin) {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return nil, false
	}

	return tag, true
}

func loadTagForShareManagement(c *gin.Context, db *bun.DB) (*models.Tag, uuid.UUID, bool, bool) {
	userID, isAdmin, ok := authz.RequireRequestUser(c, db)
	if !ok {
		return nil, uuid.Nil, false, false
	}

	tag, ok := loadManageableTag(c, db, userID, isAdmin)
	if !ok {
		return nil, uuid.Nil, false, false
	}

	return tag, userID, isAdmin, true
}

func RemoveTagFromScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		if _, _, _, ok := scanhandlers.LoadAuthorizedScanForWrite(c, db, scanID); !ok {
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
