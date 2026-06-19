package auth

import (
	"testing"
	"time"
)

func TestOIDCDebugSessionIsBoundToOwnerAndProvider(t *testing.T) {
	session, err := CreateOIDCDebugSession("keycloak", "admin-1")
	if err != nil {
		t.Fatalf("CreateOIDCDebugSession() error = %v", err)
	}
	if _, err := GetOIDCDebugSessionForFlow(session.ID, "other-provider"); err == nil {
		t.Fatal("GetOIDCDebugSessionForFlow() accepted a different provider")
	}
	if _, err := GetOIDCDebugSessionForAdmin(session.ID, "admin-2"); err == nil {
		t.Fatal("GetOIDCDebugSessionForAdmin() accepted a different owner")
	}

	report := &OIDCDebugReport{ProviderName: "keycloak", IDTokenClaims: map[string]any{"sub": "subject"}}
	if err := CompleteOIDCDebugSession(session.ID, "keycloak", report); err != nil {
		t.Fatalf("CompleteOIDCDebugSession() error = %v", err)
	}
	completed, err := GetOIDCDebugSessionForAdmin(session.ID, "admin-1")
	if err != nil {
		t.Fatalf("GetOIDCDebugSessionForAdmin() error = %v", err)
	}
	if completed.Report == nil || completed.Report.CompletedAt.IsZero() {
		t.Fatal("completed debug session did not contain a timestamped report")
	}
	if completed.Report.ResolvedGroups == nil || completed.Report.ResolvedRoles == nil ||
		completed.Report.RealmRoles == nil || completed.Report.ClientRoles == nil {
		t.Fatal("completed debug session contained nullable claim lists")
	}
	if _, err := GetOIDCDebugSessionForFlow(session.ID, "keycloak"); err == nil {
		t.Fatal("GetOIDCDebugSessionForFlow() allowed a completed session to restart")
	}
}

func TestOIDCDebugSessionExpires(t *testing.T) {
	session, err := CreateOIDCDebugSession("keycloak", "admin-1")
	if err != nil {
		t.Fatalf("CreateOIDCDebugSession() error = %v", err)
	}
	oidcDebugMu.Lock()
	oidcDebugSessions[session.ID].ExpiresAt = time.Now().Add(-time.Second)
	oidcDebugMu.Unlock()
	if _, err := GetOIDCDebugSessionForAdmin(session.ID, "admin-1"); err == nil {
		t.Fatal("GetOIDCDebugSessionForAdmin() returned an expired session")
	}
}
