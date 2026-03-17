package auth

import (
	"errors"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ValidateTokenDBEntry(token string, db *bun.DB, ctx *gin.Context) (valid bool, err error) {
	var dbToken models.Tokens
	err = db.NewSelect().Model(&dbToken).Where("key = ?", token).Scan(ctx)
	if err != nil {
		return false, err
	}

	if dbToken.ID == uuid.Nil {
		return false, errors.New("the provided token is not valid")
	}

	if dbToken.Disabled {
		return false, errors.New("the provided token is disabled")
	}

	return true, nil
}
