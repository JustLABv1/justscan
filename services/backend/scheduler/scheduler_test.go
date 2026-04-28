package scheduler

import (
	"testing"
	"time"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
)

func TestNewScheduledScanCopiesPersonalOwnership(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	registryID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	createdAt := time.Date(2026, 4, 28, 10, 0, 0, 0, time.UTC)
	item := models.WatchlistItem{
		ImageName:   "registry.example.com/team/api",
		ImageTag:    "1.0.0",
		RegistryID:  &registryID,
		UserID:      userID,
		OwnerType:   models.OwnerTypeUser,
		OwnerUserID: &userID,
	}

	scan := newScheduledScan(item, "team/api", "1.0.0", models.ScanProviderTrivy, item.RegistryID, createdAt)

	if scan.ImageName != "team/api" {
		t.Fatalf("expected normalized image name to be preserved, got %q", scan.ImageName)
	}
	if scan.ImageTag != "1.0.0" {
		t.Fatalf("expected normalized image tag to be preserved, got %q", scan.ImageTag)
	}
	if scan.ScanProvider != models.ScanProviderTrivy {
		t.Fatalf("expected scan provider %q, got %q", models.ScanProviderTrivy, scan.ScanProvider)
	}
	if scan.CurrentStep != models.ScanStepQueued {
		t.Fatalf("expected current step %q, got %q", models.ScanStepQueued, scan.CurrentStep)
	}
	if scan.Status != models.ScanStatusPending {
		t.Fatalf("expected status %q, got %q", models.ScanStatusPending, scan.Status)
	}
	assertUUIDPtr(t, "user_id", scan.UserID, userID)
	if scan.OwnerType != models.OwnerTypeUser {
		t.Fatalf("expected owner type %q, got %q", models.OwnerTypeUser, scan.OwnerType)
	}
	assertUUIDPtr(t, "owner_user_id", scan.OwnerUserID, userID)
	if scan.OwnerOrgID != nil {
		t.Fatalf("expected no owner_org_id, got %s", *scan.OwnerOrgID)
	}
	assertUUIDPtr(t, "registry_id", scan.RegistryID, registryID)
	if !scan.CreatedAt.Equal(createdAt) {
		t.Fatalf("expected created_at %s, got %s", createdAt, scan.CreatedAt)
	}
}

func TestNewScheduledScanCopiesOrgOwnership(t *testing.T) {
	userID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	orgID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	item := models.WatchlistItem{
		ImageName:   "registry.example.com/team/worker",
		ImageTag:    "stable",
		UserID:      userID,
		OwnerType:   models.OwnerTypeOrg,
		OwnerOrgID:  &orgID,
		OwnerUserID: &userID,
	}

	scan := newScheduledScan(item, item.ImageName, item.ImageTag, models.ScanProviderTrivy, nil, time.Now())

	assertUUIDPtr(t, "user_id", scan.UserID, userID)
	if scan.OwnerType != models.OwnerTypeOrg {
		t.Fatalf("expected owner type %q, got %q", models.OwnerTypeOrg, scan.OwnerType)
	}
	if scan.OwnerUserID != nil {
		t.Fatalf("expected owner_user_id to be cleared for org-owned scan, got %s", *scan.OwnerUserID)
	}
	assertUUIDPtr(t, "owner_org_id", scan.OwnerOrgID, orgID)
}

func TestNewScheduledScanDefaultsLegacyWatchlistToPersonalOwnership(t *testing.T) {
	userID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	item := models.WatchlistItem{UserID: userID}

	scan := newScheduledScan(item, "alpine", "latest", models.ScanProviderTrivy, nil, time.Now())

	if scan.OwnerType != models.OwnerTypeUser {
		t.Fatalf("expected owner type %q, got %q", models.OwnerTypeUser, scan.OwnerType)
	}
	assertUUIDPtr(t, "owner_user_id", scan.OwnerUserID, userID)
	if scan.OwnerOrgID != nil {
		t.Fatalf("expected no owner_org_id, got %s", *scan.OwnerOrgID)
	}
}

func assertUUIDPtr(t *testing.T, field string, actual *uuid.UUID, expected uuid.UUID) {
	t.Helper()
	if actual == nil {
		t.Fatalf("expected %s to be %s, got nil", field, expected)
	}
	if *actual != expected {
		t.Fatalf("expected %s to be %s, got %s", field, expected, *actual)
	}
}
