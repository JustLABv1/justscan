package auth

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
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

// GenerateStateToken generates a cryptographically random, URL-safe state token.
func GenerateStateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("oidc: failed to generate state token: %w", err)
	}
	return hex.EncodeToString(b), nil
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
