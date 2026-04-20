package users

import (
	"net/http"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func RevokeUserToken(c *gin.Context, db *bun.DB) {
	userID, isAdmin, ok := authz.RequireRequestUser(c, db)
	if !ok {
		return
	}

	tokenID, err := uuid.Parse(c.Param("tokenId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid token ID"})
		return
	}

	var token models.Tokens
	if err := db.NewSelect().Model(&token).
		Column("id", "user_id", "type", "disabled").
		Where("id = ?", tokenID).
		Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "token not found"})
		return
	}

	if token.Type != "personal" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only personal tokens can be revoked via this endpoint"})
		return
	}

	if !isAdmin && token.UserID != userID.String() {
		c.JSON(http.StatusForbidden, gin.H{"error": "you do not own this token"})
		return
	}

	if token.Disabled {
		c.JSON(http.StatusConflict, gin.H{"error": "token is already revoked"})
		return
	}

	_, err = db.NewUpdate().Model((*models.Tokens)(nil)).
		Set("disabled = ?", true).
		Set("disabled_reason = ?", "revoked").
		Where("id = ?", tokenID).
		Exec(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"result": "token revoked"})
}
