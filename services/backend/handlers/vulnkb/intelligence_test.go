package vulnkb

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"justscan-backend/pkg/models"
)

func TestNormalizePostureFilter(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  string
		valid bool
	}{
		{name: "empty", value: "", want: "", valid: true},
		{name: "changed", value: "CHANGED", want: "changed", valid: true},
		{name: "rescan", value: models.PostureStateNeedsRescan, want: models.PostureStateNeedsRescan, valid: true},
		{name: "disputed and rejected", value: "disputed_rejected", want: "disputed_rejected", valid: true},
		{name: "unknown", value: "severity_increased", valid: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizePostureFilter(tt.value)
			if (err == nil) != tt.valid {
				t.Fatalf("valid = %v, want %v, error = %v", err == nil, tt.valid, err)
			}
			if got != tt.want {
				t.Fatalf("filter = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestPublicHistoryDoesNotExposeAdminImpactFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	sqldb, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock database: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()
	mock.MatchExpectationsInOrder(false)

	vulnID := "CVE-2026-29800"
	eventID := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	now := time.Date(2026, time.January, 10, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery(`(?s)SELECT .*FROM "vuln_kb"`).
		WillReturnRows(sqlmock.NewRows([]string{"vuln_id"}).AddRow(vulnID))
	mock.ExpectQuery(`(?s)SELECT .*count\(\*\).*FROM "vulnerability_intelligence_change_events"`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(`(?s)SELECT .*FROM "vulnerability_intelligence_change_events"`).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "source", "source_event_id", "vuln_id", "event_name", "source_identifier",
			"observed_at", "before", "after", "details", "processed_at", "created_at", "updated_at",
		}).AddRow(
			eventID,
			"nvd_cve_history",
			"source-event-1",
			vulnID,
			"CVE modified",
			"NVD",
			now,
			[]byte(`{"cvss": 7.2}`),
			[]byte(`{"cvss": 8.1}`),
			[]byte(`[]`),
			now,
			now,
			now,
		))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/kb/"+vulnID+"/history?limit=1", nil)
	ctx.Params = gin.Params{{Key: "vulnId", Value: vulnID}}

	GetKBHistory(db)(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	body := recorder.Body.String()
	for _, forbidden := range []string{"raw_payload", "processing_error", "impacted_findings", "rescan_required"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("public history response contains admin-only field %q: %s", forbidden, body)
		}
	}
	if !strings.Contains(body, `"vuln_id":"`+vulnID+`"`) {
		t.Fatalf("public history response omitted CVE ID: %s", body)
	}
	if !strings.Contains(body, `"has_more":false`) {
		t.Fatalf("public history response omitted pagination state: %s", body)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestExposureQueryIncludesCompletedScanOwnershipScope(t *testing.T) {
	sqldb, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock database: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	orgID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	query := newExposureQuery(db, "CVE-2026-29800", userID, false, []uuid.UUID{orgID})
	sql := query.String()

	for _, expected := range []string{
		"JOIN scans AS s ON s.id = v.scan_id",
		"s.status = 'completed'",
		"owner_user_id =",
		"owner_org_id IN",
		"EXISTS (SELECT 1 FROM org_scans shared",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("exposure query missing %q: %s", expected, sql)
		}
	}
}
