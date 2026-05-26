package auths

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

// deriveFrontendOrigin returns the first allow_origins entry, stripping trailing slashes.
// Falls back to an empty string (relative redirect) if none is configured.
func deriveFrontendOrigin(cfg *config.RestfulConf) string {
	if len(cfg.AllowOrigins) > 0 {
		return strings.TrimRight(cfg.AllowOrigins[0], "/")
	}
	return ""
}

// sanitiseUsername removes characters not suitable for a username while preserving
// email-style usernames such as user@example.com.
func sanitiseUsername(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' || r == '@' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// uniqueUsername appends a numeric suffix if the desired username is already taken.
func uniqueUsername(ctx context.Context, db *bun.DB, desired string) (string, error) {
	candidate := desired
	for i := 2; i <= 9999; i++ {
		exists, err := db.NewSelect().Model((*models.Users)(nil)).Where("username = ?", candidate).Exists(ctx)
		if err != nil {
			return "", fmt.Errorf("oidc: failed to check username uniqueness: %w", err)
		}
		if !exists {
			return candidate, nil
		}
		candidate = fmt.Sprintf("%s%d", desired, i)
	}
	return "", errors.New("oidc: could not find a unique username")
}
