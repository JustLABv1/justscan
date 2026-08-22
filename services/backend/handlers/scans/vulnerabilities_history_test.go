package scans

import (
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

func TestBuildFirstSeenVulnerabilityQueryAppliesScanVisibility(t *testing.T) {
	sqldb, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock database: %v", err)
	}
	defer sqldb.Close()

	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	userID := uuid.New()
	orgID := uuid.New()
	query := buildFirstSeenVulnerabilityQuery(db, uuid.New(), "registry.example/app:latest", userID, false, []uuid.UUID{orgID}).
		GroupExpr("v.vuln_id, v.pkg_name").String()

	for _, expected := range []string{
		"JOIN scans AS s ON s.id = v.scan_id",
		"s.image_name = 'registry.example/app:latest'",
		"s.status = 'completed'",
		"s.user_id = '",
		"s.owner_user_id = '",
		"s.owner_org_id IN",
		"EXISTS (SELECT 1 FROM org_scans shared WHERE shared.scan_id = s.id AND shared.org_id IN",
	} {
		if !strings.Contains(query, expected) {
			t.Fatalf("visibility query missing %q: %s", expected, query)
		}
	}

	adminQuery := buildFirstSeenVulnerabilityQuery(db, uuid.New(), "registry.example/app:latest", userID, true, nil).
		GroupExpr("v.vuln_id, v.pkg_name").String()
	if strings.Contains(adminQuery, "owner_user_id") || strings.Contains(adminQuery, "owner_org_id") || strings.Contains(adminQuery, "org_scans") {
		t.Fatalf("admin query unexpectedly narrowed by ownership visibility: %s", adminQuery)
	}
}
