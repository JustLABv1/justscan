package auth

import (
	"time"

	"justwms-backend/config"
	"justwms-backend/pkg/models"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func GenerateBridgeToken(id uuid.UUID, serviceID string) (tokenString string, ExpiresAt int64, err error) {
	var jwtKey = []byte(config.Config.JWT.Secret)

	expirationTime := time.Now().Add(50 * 365 * 24 * time.Hour) // 10 years
	claims := &models.JWTBridgeClaim{
		ID:        id,
		ServiceID: serviceID,
		Type:      "bridge",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err = token.SignedString(jwtKey)
	ExpiresAt = expirationTime.Unix()
	return
}
