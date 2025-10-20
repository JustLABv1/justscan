package admins

import (
	"justwms-backend/functions/auth"
	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func GenerateBridgeToken(context *gin.Context, db *bun.DB) {
	var request models.IncBridgeTokenRequest
	if err := context.ShouldBindJSON(&request); err != nil {
		httperror.StatusBadRequest(context, "Error parsing incoming data", err)
		return
	}

	// save api key to tokens
	var token models.Tokens
	token.ID = uuid.New()
	token.Type = "bridge"
	token.Description = "API key für Bridge: " + request.BridgeID

	// generate api key
	tokenKey, expirationTime, err := auth.GenerateBridgeToken(token.ID, request.BridgeID)
	if err != nil {
		httperror.InternalServerError(context, "Error generating Bridge API key", err)
		return
	}
	token.Key = tokenKey
	token.ExpiresAt = time.Unix(expirationTime, 0)

	_, err = db.NewInsert().Model(&token).Exec(context)
	if err != nil {
		httperror.InternalServerError(context, "Error saving API key", err)
		return
	}

	context.JSON(http.StatusCreated, gin.H{
		"key": tokenKey,
	})
}
