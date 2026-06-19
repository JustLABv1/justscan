package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"
)

const oidcDebugSessionLifetime = 10 * time.Minute

var (
	errOIDCDebugSessionNotFound = errors.New("oidc debug session not found or expired")
	oidcDebugMu                 sync.Mutex
	oidcDebugSessions           = make(map[string]*OIDCDebugSession)
)

// OIDCDebugReport contains decoded, verified claims only. OAuth token strings,
// authorization codes, and client credentials must never be added here.
type OIDCDebugReport struct {
	ProviderName    string         `json:"provider_name"`
	IDTokenClaims   map[string]any `json:"id_token_claims"`
	UserInfoClaims  map[string]any `json:"userinfo_claims,omitempty"`
	UserInfoError   string         `json:"userinfo_error,omitempty"`
	GroupsClaimPath string         `json:"groups_claim_path"`
	RolesClaimPath  string         `json:"roles_claim_path"`
	ResolvedGroups  []string       `json:"resolved_groups"`
	ResolvedRoles   []string       `json:"resolved_roles"`
	RealmRoles      []string       `json:"realm_roles"`
	ClientRoles     []string       `json:"client_roles"`
	ClientRolesPath string         `json:"client_roles_path"`
	WouldBeAdmin    bool           `json:"would_be_admin"`
	CompletedAt     time.Time      `json:"completed_at"`
}

type OIDCDebugSession struct {
	ID           string           `json:"session_id"`
	ProviderName string           `json:"provider_name"`
	OwnerUserID  string           `json:"-"`
	ExpiresAt    time.Time        `json:"expires_at"`
	Report       *OIDCDebugReport `json:"report,omitempty"`
}

func CreateOIDCDebugSession(providerName, ownerUserID string) (*OIDCDebugSession, error) {
	id, err := randomDebugID()
	if err != nil {
		return nil, err
	}
	session := &OIDCDebugSession{
		ID:           id,
		ProviderName: providerName,
		OwnerUserID:  ownerUserID,
		ExpiresAt:    time.Now().Add(oidcDebugSessionLifetime),
	}
	oidcDebugMu.Lock()
	cleanupExpiredOIDCDebugSessionsLocked(time.Now())
	oidcDebugSessions[id] = session
	oidcDebugMu.Unlock()
	return cloneOIDCDebugSession(session), nil
}

// GetOIDCDebugSessionForFlow validates the unprivileged browser redirect leg.
// The random session ID is only a correlation value; reports remain admin-only.
func GetOIDCDebugSessionForFlow(id, providerName string) (*OIDCDebugSession, error) {
	oidcDebugMu.Lock()
	defer oidcDebugMu.Unlock()
	now := time.Now()
	cleanupExpiredOIDCDebugSessionsLocked(now)
	session, ok := oidcDebugSessions[id]
	if !ok || session.ProviderName != providerName || session.Report != nil {
		return nil, errOIDCDebugSessionNotFound
	}
	return cloneOIDCDebugSession(session), nil
}

func GetOIDCDebugSessionForAdmin(id, ownerUserID string) (*OIDCDebugSession, error) {
	oidcDebugMu.Lock()
	defer oidcDebugMu.Unlock()
	now := time.Now()
	cleanupExpiredOIDCDebugSessionsLocked(now)
	session, ok := oidcDebugSessions[id]
	if !ok || session.OwnerUserID != ownerUserID {
		return nil, errOIDCDebugSessionNotFound
	}
	return cloneOIDCDebugSession(session), nil
}

func CompleteOIDCDebugSession(id, providerName string, report *OIDCDebugReport) error {
	oidcDebugMu.Lock()
	defer oidcDebugMu.Unlock()
	now := time.Now()
	cleanupExpiredOIDCDebugSessionsLocked(now)
	session, ok := oidcDebugSessions[id]
	if !ok || session.ProviderName != providerName || session.Report != nil {
		return errOIDCDebugSessionNotFound
	}
	if report.IDTokenClaims == nil {
		report.IDTokenClaims = make(map[string]any)
	}
	report.ResolvedGroups = nonNilStrings(report.ResolvedGroups)
	report.ResolvedRoles = nonNilStrings(report.ResolvedRoles)
	report.RealmRoles = nonNilStrings(report.RealmRoles)
	report.ClientRoles = nonNilStrings(report.ClientRoles)
	report.CompletedAt = now
	session.Report = report
	return nil
}

func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func randomDebugID() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}

func cleanupExpiredOIDCDebugSessionsLocked(now time.Time) {
	for id, session := range oidcDebugSessions {
		if !session.ExpiresAt.After(now) {
			delete(oidcDebugSessions, id)
		}
	}
}

func cloneOIDCDebugSession(session *OIDCDebugSession) *OIDCDebugSession {
	copy := *session
	return &copy
}
