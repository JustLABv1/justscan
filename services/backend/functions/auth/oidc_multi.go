package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"justscan-backend/pkg/models"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
	"golang.org/x/oauth2"
)

// providerEntry holds an initialised go-oidc provider and its oauth2 config.
type providerEntry struct {
	provider    *gooidc.Provider
	oauth2Cfg   oauth2.Config
	model       models.OIDCProvider
	initialised bool
	initErr     error
}

var (
	providersMu    sync.RWMutex
	providersCache map[string]*providerEntry
	providersDB    *bun.DB
)

// InitMultiOIDC sets the database reference used by the multi-provider OIDC system.
// Call this once after the DB is ready.
func InitMultiOIDC(db *bun.DB) {
	providersMu.Lock()
	providersDB = db
	providersCache = make(map[string]*providerEntry)
	providersMu.Unlock()
}

// GetProviderEntry returns (or lazily initialises) the OIDC entry for the named provider.
func GetProviderEntry(ctx context.Context, name string) (*providerEntry, error) {
	providersMu.RLock()
	entry, ok := providersCache[name]
	providersMu.RUnlock()
	if ok {
		return entry, entry.initErr
	}

	// Load from DB.
	var m models.OIDCProvider
	if err := providersDB.NewSelect().Model(&m).Where("name = ? AND enabled = true", name).Scan(ctx); err != nil {
		return nil, fmt.Errorf("oidc: provider %q not found: %w", name, err)
	}

	entry = &providerEntry{model: m}
	entry.provider, entry.initErr = gooidc.NewProvider(ctx, m.IssuerURL)
	if entry.initErr != nil {
		log.Errorf("oidc: failed to init provider %q: %v", name, entry.initErr)
	} else {
		scopes := []string(m.Scopes)
		if len(scopes) == 0 {
			scopes = []string{gooidc.ScopeOpenID, "email", "profile"}
		}
		entry.oauth2Cfg = oauth2.Config{
			ClientID:     m.ClientID,
			ClientSecret: m.ClientSecret,
			RedirectURL:  m.RedirectURI,
			Endpoint:     entry.provider.Endpoint(),
			Scopes:       scopes,
		}
		entry.initialised = true
	}

	providersMu.Lock()
	providersCache[name] = entry
	providersMu.Unlock()

	return entry, entry.initErr
}

// GetOAuth2Config returns the oauth2.Config for the provider.
func (e *providerEntry) GetOAuth2Config() oauth2.Config {
	return e.oauth2Cfg
}

// GetProvider returns the underlying go-oidc provider.
func (e *providerEntry) GetProvider() *gooidc.Provider {
	return e.provider
}

// GetModel returns the provider DB model.
func (e *providerEntry) GetModel() models.OIDCProvider {
	return e.model
}

// InvalidateProviderCache removes a provider from the in-memory cache so changes
// picked up from the DB take effect on the next request.
func InvalidateProviderCache(name string) {
	providersMu.Lock()
	delete(providersCache, name)
	providersMu.Unlock()
}

// ListEnabledProviders returns all enabled providers from the DB ordered by sort_order.
func ListEnabledProviders(ctx context.Context) ([]models.OIDCProvider, error) {
	var providers []models.OIDCProvider
	err := providersDB.NewSelect().Model(&providers).
		Where("enabled = true").
		OrderExpr("sort_order ASC, name ASC").
		Scan(ctx)
	return providers, err
}

// ExtractOIDCClaimsForProvider parses an OIDC ID token using the named provider's
// configured claim keys.
func ExtractOIDCClaimsForProvider(idToken *gooidc.IDToken, m models.OIDCProvider) (*OIDCClaims, error) {
	var raw map[string]json.RawMessage
	if err := idToken.Claims(&raw); err != nil {
		return nil, fmt.Errorf("oidc: failed to extract claims: %w", err)
	}
	var decoded map[string]any
	if err := idToken.Claims(&decoded); err != nil {
		return nil, fmt.Errorf("oidc: failed to decode claims: %w", err)
	}

	claims := &OIDCClaims{Sub: idToken.Subject, RawClaims: decoded}
	for key, dest := range map[string]*string{
		"email":              &claims.Email,
		"preferred_username": &claims.PreferredUsername,
	} {
		if v, ok := raw[key]; ok {
			var s string
			if json.Unmarshal(v, &s) == nil {
				*dest = s
			}
		}
	}
	if claims.PreferredUsername == "" && claims.Email != "" {
		claims.PreferredUsername = claims.Email
	}

	groupsClaim := m.GroupsClaim
	if groupsClaim == "" {
		groupsClaim = "groups"
	}
	rolesClaim := m.RolesClaim
	if rolesClaim == "" {
		rolesClaim = "roles"
	}

	claims.Groups = uniqueStrings(extractStringSlice(decoded, groupsClaim))
	claims.Roles = uniqueStrings(extractStringSlice(decoded, rolesClaim))
	claims.Roles = uniqueStrings(append(claims.Roles,
		extractStringSlice(decoded, "realm_access.roles")...,
	))
	claims.Roles = uniqueStrings(append(claims.Roles,
		extractStringSlice(decoded, fmt.Sprintf("resource_access.%s.roles", m.ClientID))...,
	))
	return claims, nil
}

// IsAdminForProvider checks admin group/role membership against a specific provider model.
func IsAdminForProvider(claims *OIDCClaims, m models.OIDCProvider) bool {
	for _, ag := range m.AdminGroups {
		for _, g := range claims.Groups {
			if g == ag {
				return true
			}
		}
	}
	for _, ar := range m.AdminRoles {
		for _, r := range claims.Roles {
			if r == ar {
				return true
			}
		}
	}
	return false
}

// FetchUserInfoGroups calls the OIDC provider's UserInfo endpoint using the stored
// access token and returns fresh group claims. Used for token-refresh group sync.
func FetchUserInfoGroups(ctx context.Context, entry *providerEntry, accessToken string) ([]string, error) {
	userInfo, err := entry.provider.UserInfo(ctx, oauth2.StaticTokenSource(&oauth2.Token{
		AccessToken: accessToken,
		Expiry:      time.Now().Add(time.Minute), // assume valid; errors handled below
	}))
	if err != nil {
		return nil, fmt.Errorf("oidc: failed to fetch userinfo: %w", err)
	}

	var claims map[string]any
	if err := userInfo.Claims(&claims); err != nil {
		return nil, fmt.Errorf("oidc: failed to parse userinfo claims: %w", err)
	}

	groupsClaim := entry.model.GroupsClaim
	if groupsClaim == "" {
		groupsClaim = "groups"
	}
	return uniqueStrings(extractStringSlice(claims, groupsClaim)), nil
}

// extractClaimsGroupsClaim extracts the groups from claims using the provider's configured claim key.
func extractClaimsGroupsClaim(claims map[string]any, groupsClaim string) []string {
	if groupsClaim == "" {
		groupsClaim = "groups"
	}
	parts := strings.Split(groupsClaim, ".")
	var current any = claims
	for _, p := range parts {
		m, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = m[p]
	}
	switch v := current.(type) {
	case []any:
		result := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				result = append(result, s)
			}
		}
		return result
	case []string:
		return v
	}
	return nil
}
