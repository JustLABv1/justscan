package auths

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func normalizeOrigin(value string) string {
	return strings.TrimRight(strings.TrimSpace(value), "/")
}

func firstHeaderValue(value string) string {
	if value == "" {
		return ""
	}
	return strings.TrimSpace(strings.Split(value, ",")[0])
}

func requestOrigin(r *http.Request) string {
	proto := firstHeaderValue(r.Header.Get("X-Forwarded-Proto"))
	if proto == "" {
		if r.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}

	host := firstHeaderValue(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = strings.TrimSpace(r.Host)
	}
	if host == "" {
		return ""
	}

	return fmt.Sprintf("%s://%s", proto, host)
}

// deriveFrontendOrigin prefers the current request origin when it is present in
// allow_origins. This keeps multi-ingress deployments on the same host.
func deriveFrontendOrigin(cfg *config.RestfulConf, r *http.Request) string {
	candidate := normalizeOrigin(requestOrigin(r))
	if candidate != "" {
		if len(cfg.AllowOrigins) == 0 {
			return candidate
		}
		for _, allowed := range cfg.AllowOrigins {
			if normalizeOrigin(allowed) == candidate {
				return candidate
			}
		}
	}
	if len(cfg.AllowOrigins) > 0 {
		return normalizeOrigin(cfg.AllowOrigins[0])
	}
	return candidate
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
