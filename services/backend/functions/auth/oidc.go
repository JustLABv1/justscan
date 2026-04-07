package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
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
	RawClaims         map[string]any
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

	var decoded map[string]any
	if err := idToken.Claims(&decoded); err != nil {
		return nil, fmt.Errorf("oidc: failed to decode claims: %w", err)
	}

	claims := &OIDCClaims{Sub: idToken.Subject, RawClaims: decoded}

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
	// preferred_username fallback: use the full email address if the provider does not
	// send a dedicated username claim. Some deployments intentionally use email-style usernames.
	if claims.PreferredUsername == "" && claims.Email != "" {
		claims.PreferredUsername = claims.Email
	}

	// Groups claim (configurable key)
	claims.Groups = uniqueStrings(extractStringSlice(decoded, cfg.OIDC.GroupsClaim))

	// Roles claim (configurable key)
	claims.Roles = uniqueStrings(extractStringSlice(decoded, cfg.OIDC.RolesClaim))

	// Keycloak commonly stores realm roles in realm_access.roles and client roles in
	// resource_access.<client_id>.roles rather than a flat top-level claim.
	claims.Roles = uniqueStrings(append(claims.Roles,
		extractStringSlice(decoded, "realm_access.roles")...,
	))
	claims.Roles = uniqueStrings(append(claims.Roles,
		extractStringSlice(decoded, fmt.Sprintf("resource_access.%s.roles", cfg.OIDC.ClientID))...,
	))

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

// extractStringSlice reads a claim by dotted path and returns it as a slice of strings.
// Supported shapes:
// - ["a", "b"]
// - "a b"
// - nested objects via paths like "realm_access.roles" or "resource_access.justscan.roles"
func extractStringSlice(claims map[string]any, path string) []string {
	if path == "" {
		return nil
	}

	var current any = claims
	for _, part := range strings.Split(path, ".") {
		obj, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current, ok = obj[part]
		if !ok {
			return nil
		}
	}

	switch value := current.(type) {
	case []string:
		return value
	case []any:
		result := make([]string, 0, len(value))
		for _, item := range value {
			if s, ok := item.(string); ok && s != "" {
				result = append(result, s)
			}
		}
		return result
	case string:
		if value == "" {
			return nil
		}
		return splitSpaces(value)
	default:
		return nil
	}
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

func uniqueStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
