package tokens

import (
	"net/http"
	"time"

	"justwms-backend/functions/auth"
	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type TokenRequestBridge struct {
	BridgeID string `json:"bridge_id"`
}

func GenerateTokenBridge(db *bun.DB, context *gin.Context) {
	var request TokenRequestBridge
	if err := context.ShouldBindJSON(&request); err != nil {
		context.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		context.Abort()
		return
	}

	// generate token
	token := models.Tokens{
		ID:          uuid.New(),
		Description: "Bridge Token for " + request.BridgeID,
		Type:        "bridge",
		CreatedAt:   time.Now(),
	}
	tokenString, ExpiresAt, err := auth.GenerateBridgeToken(token.ID, request.BridgeID)
	if err != nil {
		httperror.InternalServerError(context, "Error generating user token", err)
		return
	}

	// write token in tokens table
	token.Key = tokenString
	token.ExpiresAt = time.Unix(ExpiresAt, 0)

	_, err = db.NewInsert().Model(&token).Exec(context)
	if err != nil {
		httperror.InternalServerError(context, "Error writing token to db", err)
		return
	}

	context.JSON(http.StatusOK, gin.H{"token": tokenString})
}
