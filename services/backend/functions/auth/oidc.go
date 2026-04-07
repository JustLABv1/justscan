package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"

	"justscan-backend/config"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

var (
	oidcProvider     *gooidc.Provider
	oidcOAuth2Config oauth2.Config
	oidcOnce         sync.Once
	oidcInitErr      error
)

// OIDCClaims holds the parsed claims from an OIDC ID token.
type OIDCClaims struct {
	Sub               string
	Email             string
	PreferredUsername string
	Groups            []string
	Roles             []string
}

// InitOIDCProvider initialises the OIDC provider singleton. Safe to call multiple times;
// only executes once. Returns an error if OIDC is enabled but initialisation fails.
func InitOIDCProvider(ctx context.Context) error {
	cfg := config.Config
	if !cfg.OIDC.Enabled {
		return nil
	}

	oidcOnce.Do(func() {
		provider, err := gooidc.NewProvider(ctx, cfg.OIDC.IssuerURL)
		if err != nil {
			oidcInitErr = fmt.Errorf("oidc: failed to discover provider %q: %w", cfg.OIDC.IssuerURL, err)
			return
		}

		scopes := cfg.OIDC.Scopes
		if len(scopes) == 0 {
			scopes = []string{gooidc.ScopeOpenID, "email", "profile"}
		}

		oidcProvider = provider
		oidcOAuth2Config = oauth2.Config{
			ClientID:     cfg.OIDC.ClientID,
			ClientSecret: cfg.OIDC.ClientSecret,
			RedirectURL:  cfg.OIDC.RedirectURI,
			Endpoint:     provider.Endpoint(),
			Scopes:       scopes,
		}
	})

	return oidcInitErr
}

// GetOIDCProvider returns the initialised provider. Returns nil if OIDC is disabled or not yet initialised.
func GetOIDCProvider() *gooidc.Provider {
	return oidcProvider
}

// GetOIDCOAuth2Config returns a copy of the oauth2.Config for the current request.
// RedirectURL can be overridden per-request if needed.
func GetOIDCOAuth2Config() oauth2.Config {
	return oidcOAuth2Config
}

// GenerateStateToken generates a cryptographically random, URL-safe state token.
func GenerateStateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("oidc: failed to generate state token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// ExtractOIDCClaims parses an OIDC ID token and returns the relevant claims using
// the claim keys configured in config.OIDC (groups_claim, roles_claim).
func ExtractOIDCClaims(idToken *gooidc.IDToken) (*OIDCClaims, error) {
	cfg := config.Config

	// Extract all claims into a raw map so we can handle custom claim keys.
	var raw map[string]json.RawMessage
	if err := idToken.Claims(&raw); err != nil {
		return nil, fmt.Errorf("oidc: failed to extract claims: %w", err)
	}

	claims := &OIDCClaims{Sub: idToken.Subject}

	// Standard string claims
	for key, dest := range map[string]*string{
		"email":              &claims.Email,
		"preferred_username": &claims.PreferredUsername,
		// fallback username sources
		"name": nil,
	} {
		if v, ok := raw[key]; ok {
			var s string
			if err := json.Unmarshal(v, &s); err == nil && dest != nil {
				*dest = s
			}
		}
	}
	// preferred_username fallback: use email local-part if empty
	if claims.PreferredUsername == "" && claims.Email != "" {
		for i, c := range claims.Email {
			if c == '@' {
				claims.PreferredUsername = claims.Email[:i]
				break
			}
		}
	}

	// Groups claim (configurable key)
	claims.Groups = extractStringSlice(raw, cfg.OIDC.GroupsClaim)

	// Roles claim (configurable key)
	claims.Roles = extractStringSlice(raw, cfg.OIDC.RolesClaim)

	return claims, nil
}

// IsAdmin returns true when the OIDC claims match any configured admin group or admin role.
func IsAdmin(claims *OIDCClaims) bool {
	cfg := config.Config

	for _, ag := range cfg.OIDC.AdminGroups {
		for _, g := range claims.Groups {
			if g == ag {
				return true
			}
		}
	}
	for _, ar := range cfg.OIDC.AdminRoles {
		for _, r := range claims.Roles {
			if r == ar {
				return true
			}
		}
	}
	return false
}

// extractStringSlice attempts to unmarshal a JSON value as either a []string or a space-separated string.
func extractStringSlice(raw map[string]json.RawMessage, key string) []string {
	v, ok := raw[key]
	if !ok {
		return nil
	}
	var slice []string
	if err := json.Unmarshal(v, &slice); err == nil {
		return slice
	}
	// Some providers encode as a space-separated string
	var s string
	if err := json.Unmarshal(v, &s); err == nil && s != "" {
		return splitSpaces(s)
	}
	return nil
}

func splitSpaces(s string) []string {
	var out []string
	start := -1
	for i, c := range s {
		if c == ' ' {
			if start >= 0 {
				out = append(out, s[start:i])
				start = -1
			}
		} else if start < 0 {
			start = i
		}
	}
	if start >= 0 {
		out = append(out, s[start:])
	}
	return out
}
