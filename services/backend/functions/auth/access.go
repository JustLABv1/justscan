package auth

import (
	"context"
	"errors"
	"strings"

	"justscan-backend/functions/gatekeeper"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ResolveUserAccess(signedToken string, db *bun.DB) (uuid.UUID, bool, error) {
	normalizedToken := strings.TrimPrefix(signedToken, "Bearer ")

	tokenType, err := GetTypeFromToken(signedToken)
	if err != nil {
		return uuid.Nil, false, err
	}
	if tokenType != "user" && tokenType != "personal" {
		return uuid.Nil, false, errors.New("user token required")
	}

	var dbToken models.Tokens
	if err := db.NewSelect().Model(&dbToken).Where("key = ?", normalizedToken).Scan(context.Background()); err != nil {
		return uuid.Nil, false, err
	}
	if dbToken.Disabled {
		return uuid.Nil, false, errors.New("token is disabled")
	}
	if dbToken.Type != tokenType {
		return uuid.Nil, false, errors.New("token type mismatch")
	}

	userID, err := GetUserIDFromToken(normalizedToken)
	if err != nil {
		return uuid.Nil, false, err
	}

	userDisabled, err := gatekeeper.CheckAccountStatus(userID.String(), db)
	if err != nil {
		return uuid.Nil, false, err
	}
	if userDisabled {
		return uuid.Nil, false, errors.New("user is disabled")
	}

	isAdmin, err := gatekeeper.CheckAdmin(userID, db)
	if err != nil {
		return uuid.Nil, false, err
	}

	return userID, isAdmin, nil
}
