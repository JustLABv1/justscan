package orgs

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"justscan-backend/functions/audit"
	"justscan-backend/functions/auth"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ListOrgTokens(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleViewer); !ok {
			return
		}

		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 200 {
			limit = 50
		}
		offset := (page - 1) * limit

		var tokens []models.Tokens
		q := db.NewSelect().Model(&tokens).
			Column("id", "description", "type", "disabled", "disabled_reason", "created_at", "expires_at", "user_id", "org_id").
			Where("org_id = ?", orgID).
			OrderExpr("created_at DESC").
			Limit(limit).
			Offset(offset)

		total, err := q.Count(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count tokens"})
			return
		}

		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list tokens"})
			return
		}
		if tokens == nil {
			tokens = []models.Tokens{}
		}

		c.JSON(http.StatusOK, gin.H{"data": tokens, "total": total})
	}
}

func CreateOrgToken(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		_, _, userID, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin)
		if !ok {
			return
		}

		var body struct {
			Description string `json:"description" binding:"required"`
			ExpiresIn   int    `json:"expires_in"` // seconds, 0 = 90 days default
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		expiry := 90 * 24 * time.Hour
		if body.ExpiresIn > 0 {
			expiry = time.Duration(body.ExpiresIn) * time.Second
		}

		tokenString, expiresAt, err := auth.GenerateJWT(userID, false)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
			return
		}
		_ = expiresAt

		token := models.Tokens{
			UserID:      userID.String(),
			OrgID:       &orgID,
			Key:         tokenString,
			Description: body.Description,
			Type:        "org",
			ExpiresAt:   time.Now().Add(expiry),
			CreatedAt:   time.Now(),
		}
		if _, err := db.NewInsert().Model(&token).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create token"})
			return
		}

		go audit.WriteOrgAction(context.Background(), db, userID.String(), orgID, "org.token.create",
			fmt.Sprintf("Created org token %s: %s", token.ID, body.Description))

		c.JSON(http.StatusCreated, gin.H{
			"id":          token.ID,
			"key":         token.Key,
			"description": token.Description,
			"expires_at":  token.ExpiresAt,
			"created_at":  token.CreatedAt,
		})
	}
}

func RevokeOrgToken(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		_, _, userID, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin)
		if !ok {
			return
		}

		tokenID, err := uuid.Parse(c.Param("tokenId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid token ID"})
			return
		}

		result, err := db.NewUpdate().Model((*models.Tokens)(nil)).
			Set("disabled = true").
			Set("disabled_reason = ?", "revoked").
			Where("id = ? AND org_id = ?", tokenID, orgID).
			Exec(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke token"})
			return
		}
		rows, _ := result.RowsAffected()
		if rows == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "token not found"})
			return
		}

		go audit.WriteOrgAction(context.Background(), db, userID.String(), orgID, "org.token.revoke",
			fmt.Sprintf("Revoked org token %s", tokenID))

		c.JSON(http.StatusOK, gin.H{"result": "revoked"})
	}
}
