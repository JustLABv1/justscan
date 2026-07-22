package orgs

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"justscan-backend/functions/audit"
	"justscan-backend/functions/auth"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

const (
	defaultOrgTokenLifetime = 90 * 24 * time.Hour
	maximumOrgTokenLifetime = 5 * 365 * 24 * time.Hour
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
			Column("id", "description", "type", "disabled", "disabled_reason", "created_at", "expires_at", "user_id", "org_id", "scope").
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
		org, _, userID, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin)
		if !ok {
			return
		}
		if !authz.EnsureOrgActionAllowed(c, org, "org_token") {
			return
		}

		var body struct {
			Description string `json:"description" binding:"required"`
			ExpiresIn   *int   `json:"expires_in"` // seconds; omitted defaults to 90 days
			Scope       string `json:"scope"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		expiry, err := resolveOrgTokenLifetime(body.ExpiresIn)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		expiresAt := time.Now().Add(expiry)
		scope, validScope := normalizeOrgTokenScope(body.Scope)
		if !validScope {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org token scope"})
			return
		}

		// Pre-generate the token UUID so we can embed it in the JWT claim.
		// The middleware will look up the record by this ID to obtain org_id.
		tokenID := uuid.New()
		tokenString, err := auth.GenerateOrgToken(tokenID, expiresAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
			return
		}

		token := models.Tokens{
			ID:          tokenID,
			UserID:      userID.String(),
			OrgID:       &orgID,
			Key:         tokenString,
			Description: body.Description,
			Type:        "org",
			Scope:       scope,
			ExpiresAt:   expiresAt,
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
			"scope":       token.Scope,
		})
	}
}

func resolveOrgTokenLifetime(expiresIn *int) (time.Duration, error) {
	if expiresIn == nil {
		return defaultOrgTokenLifetime, nil
	}

	if *expiresIn == 0 {
		return maximumOrgTokenLifetime, nil
	}

	lifetime := time.Duration(*expiresIn) * time.Second
	if lifetime < time.Hour || lifetime > maximumOrgTokenLifetime {
		return 0, fmt.Errorf("token lifetime must be between 1 hour and 5 years")
	}
	return lifetime, nil
}

func normalizeOrgTokenScope(raw string) (string, bool) {
	switch strings.TrimSpace(raw) {
	case "":
		return models.OrgTokenScopeAdmin, true
	case models.OrgTokenScopeAdmin:
		return models.OrgTokenScopeAdmin, true
	case models.OrgTokenScopePipelineScan:
		return models.OrgTokenScopePipelineScan, true
	default:
		return "", false
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

// DeleteRevokedOrgToken permanently removes an already-revoked token record.
// Active tokens must be revoked first so access loss remains an intentional action.
func DeleteRevokedOrgToken(db *bun.DB) gin.HandlerFunc {
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

		result, err := db.NewDelete().Model((*models.Tokens)(nil)).
			Where("id = ? AND org_id = ? AND disabled = true", tokenID, orgID).
			Exec(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete token"})
			return
		}
		rows, _ := result.RowsAffected()
		if rows == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "revoked token not found"})
			return
		}

		go audit.WriteOrgAction(context.Background(), db, userID.String(), orgID, "org.token.delete",
			fmt.Sprintf("Deleted revoked org token %s", tokenID))

		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}
