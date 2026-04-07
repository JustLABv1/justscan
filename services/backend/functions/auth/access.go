package auth

import (
	"errors"

	"justscan-backend/functions/gatekeeper"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ResolveUserAccess(signedToken string, db *bun.DB) (uuid.UUID, bool, error) {
	tokenType, err := GetTypeFromToken(signedToken)
	if err != nil {
		return uuid.Nil, false, err
	}
	if tokenType != "user" {
		return uuid.Nil, false, errors.New("user token required")
	}

	userID, err := GetUserIDFromToken(signedToken)
	if err != nil {
		return uuid.Nil, false, err
	}

	isAdmin, err := gatekeeper.CheckAdmin(userID, db)
	if err != nil {
		return uuid.Nil, false, err
	}

	return userID, isAdmin, nil
}
