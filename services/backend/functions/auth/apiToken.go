package auth

import (
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// GeneratePersonalToken creates a long-lived personal access token for a user.
// The JWT ID is the user's UUID so the middleware can extract it identically to
// a "user" session token.
func GeneratePersonalToken(userID uuid.UUID, expiresAt time.Time) (tokenString string, err error) {
	jwtKey := []byte(config.Config.JWT.Secret)
	claims := &models.JWTClaim{
		ID:   userID,
		Type: "personal",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err = token.SignedString(jwtKey)
	return
}

// GenerateOrgToken creates a long-lived service-account token scoped to an org.
// The JWT ID is the token's own UUID so the middleware can look up the record
// by ID to retrieve the associated org_id.
func GenerateOrgToken(tokenID uuid.UUID, expiresAt time.Time) (tokenString string, err error) {
	jwtKey := []byte(config.Config.JWT.Secret)
	claims := &models.JWTClaim{
		ID:   tokenID,
		Type: "org",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err = token.SignedString(jwtKey)
	return
}
