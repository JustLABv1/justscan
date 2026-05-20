package tokens

import (
	"net/http"
	"strings"
	"time"

	"justscan-backend/functions/auth"
	"justscan-backend/functions/httperror"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func RefreshToken(context *gin.Context, db *bun.DB) {
	token := strings.TrimPrefix(context.GetHeader("Authorization"), "Bearer ")
	if token == "" {
		context.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var dbToken models.Tokens
	if err := db.NewSelect().Model(&dbToken).
		Column("id", "key", "type", "disabled").
		Where("key = ?", token).
		Scan(context); err != nil {
		context.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	if dbToken.Disabled {
		context.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	if dbToken.Type != "user" && dbToken.Type != "personal" {
		context.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	newToken, expiresAt, err := auth.RefreshToken(token)
	if err != nil {
		if err.Error() == "token is not close to expiration" {
			httperror.StatusBadRequest(context, "Token is not close to expiration", err)
			return
		}
		httperror.InternalServerError(context, "Error refreshing active token", err)
		return
	}

	userID, err := auth.GetUserIDFromToken(newToken)
	if err != nil {
		httperror.InternalServerError(context, "Error collecting userID from token", err)
		return
	}

	var user models.Users
	err = db.NewSelect().Model(&user).Column("id", "username", "email", "disabled", "role").Where("id = ?", userID).Scan(context)
	if err != nil {
		httperror.InternalServerError(context, "Error collecting user informations from db", err)
		return
	}
	if user.Disabled {
		context.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	// Update the existing token row only when it is still active.
	_, err = db.NewUpdate().Model((*models.Tokens)(nil)).
		Set("expires_at = ?", time.Unix(expiresAt, 0)).
		Set("key = ?", newToken).
		Where("id = ?", dbToken.ID).
		Where("disabled = false").
		Exec(context)
	if err != nil {
		httperror.InternalServerError(context, "Error updating token expiration time", err)
		return
	}

	context.JSON(http.StatusOK, gin.H{"result": "success", "token": newToken, "expires_at": expiresAt, "user": user})
}
