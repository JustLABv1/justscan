package auth

import (
	"context"
	"fmt"
	"time"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func RecordSuccessfulLogin(ctx context.Context, db *bun.DB, user *models.Users, method string) error {
	loginTime := time.Now().UTC()
	user.AuthType = method
	user.LastLoginMethod = method
	user.LastLoginAt = &loginTime

	if _, err := db.NewUpdate().Model(user).
		Column("auth_type", "last_login_method", "last_login_at").
		Where("id = ?", user.ID).
		Exec(ctx); err != nil {
		return fmt.Errorf("update login metadata: %w", err)
	}

	return nil
}
