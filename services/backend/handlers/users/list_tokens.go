package users

import (
	"net/http"
	"strconv"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func ListUserTokens(c *gin.Context, db *bun.DB) {
	userID, _, ok := authz.RequireRequestUser(c, db)
	if !ok {
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
		Column("id", "description", "type", "disabled", "disabled_reason", "created_at", "expires_at").
		Where("user_id = ? AND type = 'personal'", userID).
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
