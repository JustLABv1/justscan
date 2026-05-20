package tokens

import (
	"net/http"

	"justscan-backend/functions/auth"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func ValidateToken(context *gin.Context, db *bun.DB) {
	token := context.GetHeader("Authorization")
	if token == "" {
		context.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	_, _, err := auth.ResolveUserAccess(token, db)
	if err != nil {
		context.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	context.JSON(http.StatusOK, gin.H{"result": "success"})
}
