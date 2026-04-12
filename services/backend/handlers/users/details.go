package users

import (
	"net/http"

	"justscan-backend/functions/auth"
	"justscan-backend/functions/httperror"
	"justscan-backend/pkg/models"

	_ "github.com/lib/pq"
	"github.com/uptrace/bun"

	"github.com/gin-gonic/gin"
)

func GetUserDetails(context *gin.Context, db *bun.DB) {
	userID, err := auth.GetUserIDFromToken(context.GetHeader("Authorization"))
	if err != nil {
		httperror.Unauthorized(context, "Error receiving userID from token", err)
		return
	}

	var user models.Users
	err = db.NewSelect().Model(&user).Column("id", "username", "email", "role", "disabled", "disabled_reason", "auth_type", "last_login_at", "last_login_method", "created_at", "updated_at").Where("id = ?", userID).Scan(context)
	if err != nil {
		httperror.InternalServerError(context, "Error collecting user data from db", err)
		return
	}

	context.JSON(http.StatusCreated, gin.H{"result": "success", "user": user})
}
