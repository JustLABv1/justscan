package auth

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	"github.com/golang-jwt/jwt/v5"
	"github.com/uptrace/bun"
)

const (
	SetupCompletedSettingKey = "setup.completed"
	SetupCookieName          = "justscan_setup_session"
	setupSessionType         = "setup_session"
	setupSessionDuration     = 20 * time.Minute
)

type SetupStatus struct {
	SetupEnabled   bool
	SetupRequired  bool
	SetupCompleted bool
}

func IsSetupTokenConfigured() bool {
	return strings.TrimSpace(config.Config.Setup.Token) != ""
}

func ValidateSetupToken(token string) bool {
	expected := strings.TrimSpace(config.Config.Setup.Token)
	provided := strings.TrimSpace(token)
	if expected == "" || provided == "" || len(expected) != len(provided) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(provided)) == 1
}

func ResolveSetupStatus(ctx context.Context, db *bun.DB) (SetupStatus, error) {
	completed, err := resolveSetupCompleted(ctx, db)
	if err != nil {
		return SetupStatus{}, err
	}
	enabled := IsSetupTokenConfigured()
	return SetupStatus{
		SetupEnabled:   enabled,
		SetupRequired:  enabled && !completed,
		SetupCompleted: completed,
	}, nil
}

func SetupRequired(ctx context.Context, db *bun.DB) (bool, error) {
	status, err := ResolveSetupStatus(ctx, db)
	if err != nil {
		return false, err
	}
	return status.SetupRequired, nil
}

func MarkSetupCompleted(ctx context.Context, db bun.IDB) error {
	return UpsertSystemSetting(ctx, db, SetupCompletedSettingKey, "true")
}

func UpsertSystemSetting(ctx context.Context, db bun.IDB, key string, value string) error {
	_, err := db.NewRaw(`
		INSERT INTO system_settings (key, value, updated_at)
		VALUES (?, ?, now())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
	`, key, value).Exec(ctx)
	return err
}

func GenerateSetupSession() (tokenString string, expiresAt int64, err error) {
	jwtKey := []byte(config.Config.JWT.Secret)
	expirationTime := time.Now().Add(setupSessionDuration)
	claims := &models.SetupSessionClaim{
		Type: setupSessionType,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err = token.SignedString(jwtKey)
	expiresAt = expirationTime.Unix()
	return
}

func ParseSetupSession(signedToken string) (expiresAt int64, err error) {
	jwtKey := []byte(config.Config.JWT.Secret)
	token, err := jwt.ParseWithClaims(
		signedToken,
		&models.SetupSessionClaim{},
		func(token *jwt.Token) (interface{}, error) {
			return jwtKey, nil
		},
	)
	if err != nil {
		return 0, err
	}
	claims, ok := token.Claims.(*models.SetupSessionClaim)
	if !ok {
		return 0, errors.New("could not parse setup session claims")
	}
	if claims.Type != setupSessionType {
		return 0, errors.New("invalid setup session type")
	}
	if claims.ExpiresAt == nil || claims.ExpiresAt.Time.Before(time.Now()) {
		return 0, errors.New("setup session expired")
	}
	return claims.ExpiresAt.Unix(), nil
}

func resolveSetupCompleted(ctx context.Context, db *bun.DB) (bool, error) {
	var setting models.SystemSetting
	err := db.NewSelect().Model(&setting).Where("key = ?", SetupCompletedSettingKey).Scan(ctx)
	if err == nil {
		parsed, parseErr := strconv.ParseBool(setting.Value)
		if parseErr == nil {
			return parsed, nil
		}
		return setting.Value == "1" || strings.EqualFold(setting.Value, "yes"), nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, err
	}

	legacyConfigured, err := inferLegacyConfigured(ctx, db)
	if err != nil {
		return false, err
	}
	if !legacyConfigured {
		return false, nil
	}
	if err := MarkSetupCompleted(ctx, db); err != nil {
		return false, err
	}
	return true, nil
}

func inferLegacyConfigured(ctx context.Context, db *bun.DB) (bool, error) {
	userCount, err := db.NewSelect().Model((*models.Users)(nil)).Count(ctx)
	if err != nil {
		return false, err
	}
	if userCount > 0 {
		return true, nil
	}

	providerCount, err := db.NewSelect().Model((*models.OIDCProvider)(nil)).Count(ctx)
	if err != nil {
		return false, err
	}
	return providerCount > 0, nil
}
