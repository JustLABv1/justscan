package scans

import (
	"context"
	"testing"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
)

func TestCanReadScanHonorsResolvedIdentity(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	otherUserID := uuid.New()
	orgID := uuid.New()

	ownedScan := &models.Scan{UserID: &userID}
	if !CanReadScan(ctx, nil, ownedScan, ScanAccessContext{UserID: userID}) {
		t.Fatal("the owner should be able to read the scan")
	}

	if CanReadScan(ctx, nil, ownedScan, ScanAccessContext{UserID: otherUserID}) {
		t.Fatal("an unrelated user should not be able to read a personal scan")
	}

	orgScan := &models.Scan{OwnerOrgID: &orgID}
	if !CanReadScan(ctx, nil, orgScan, ScanAccessContext{UserID: otherUserID, AccessibleOrgIDs: []uuid.UUID{orgID}}) {
		t.Fatal("a member of the owning organization should be able to read the scan")
	}

	if !CanReadScan(ctx, nil, &models.Scan{}, ScanAccessContext{UserID: otherUserID, IsAdmin: true}) {
		t.Fatal("an administrator should be able to read any scan")
	}
}
