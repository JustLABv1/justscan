package triage

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"justscan-backend/middlewares"
	"justscan-backend/pkg/models"
)

func TestGetTriageIgnoresSupersededScanFindings(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	mock.ExpectQuery(`SELECT .*FROM "scans" AS "scan".*DISTINCT ON.*latest_scan.*image_name.*image_tag.*owner_type.*created_at DESC.*`).
		WillReturnRows(sqlmock.NewRows(scanColumns()))
	mock.ExpectQuery(`SELECT .*FROM compliance_results AS cr.*DISTINCT ON.*latest_scan.*image_name.*image_tag.*owner_type.*created_at DESC.*`).
		WillReturnRows(sqlmock.NewRows([]string{"scan_id", "policy_name", "evaluated_at"}))
	mock.ExpectQuery(`SELECT .*FROM "watchlist_items" AS "watchlist_item".*`).
		WillReturnRows(sqlmock.NewRows(watchlistColumns()))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/triage", nil)
	ctx.Set(middlewares.AuthContextUserIDKey, uuid.MustParse("11111111-1111-1111-1111-111111111111"))
	ctx.Set(middlewares.AuthContextIsAdminKey, true)

	GetTriage(db)(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	var got response
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(got.Items) != 0 {
		t.Fatalf("expected no triage items for superseded scan, got %d", len(got.Items))
	}
	if got.Summary.Total != 0 {
		t.Fatalf("expected empty summary, got %+v", got.Summary)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestGetTriageIgnoresSupersededPolicyFailures(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	mock.ExpectQuery(`SELECT .*FROM "scans" AS "scan".*DISTINCT ON.*latest_scan.*image_name.*image_tag.*owner_type.*created_at DESC.*`).
		WillReturnRows(sqlmock.NewRows(scanColumns()))
	mock.ExpectQuery(`SELECT .*FROM compliance_results AS cr.*DISTINCT ON.*latest_scan.*image_name.*image_tag.*owner_type.*created_at DESC.*`).
		WillReturnRows(sqlmock.NewRows([]string{"scan_id", "policy_name", "evaluated_at"}))
	mock.ExpectQuery(`SELECT .*FROM "watchlist_items" AS "watchlist_item".*`).
		WillReturnRows(sqlmock.NewRows(watchlistColumns()))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/triage", nil)
	ctx.Set(middlewares.AuthContextUserIDKey, uuid.MustParse("22222222-2222-2222-2222-222222222222"))
	ctx.Set(middlewares.AuthContextIsAdminKey, true)

	GetTriage(db)(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	var got response
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	for _, item := range got.Items {
		if item.Kind == kindPolicy {
			t.Fatalf("expected no policy triage item from superseded scan, got %+v", item)
		}
	}
	if got.Summary.PolicyFailures != 0 {
		t.Fatalf("expected no policy failures in summary, got %+v", got.Summary)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestGetTriageKeepsLatestScansSeparateByTag(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	now := time.Date(2026, time.May, 29, 10, 0, 0, 0, time.UTC)
	scanA := models.Scan{
		ID:             uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
		ImageName:      "ghcr.io/acme/api",
		ImageTag:       "1.0.0",
		Status:         models.ScanStatusCompleted,
		HighCount:      2,
		OwnerType:      models.OwnerTypeUser,
		OwnerUserID:    ptrUUID(uuid.MustParse("33333333-3333-3333-3333-333333333333")),
		UserID:         ptrUUID(uuid.MustParse("33333333-3333-3333-3333-333333333333")),
		CreatedAt:      now,
		LastProgressAt: ptrTime(now),
	}
	scanB := models.Scan{
		ID:             uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
		ImageName:      "ghcr.io/acme/api",
		ImageTag:       "1.1.0",
		Status:         models.ScanStatusCompleted,
		CriticalCount:  1,
		OwnerType:      models.OwnerTypeUser,
		OwnerUserID:    ptrUUID(uuid.MustParse("33333333-3333-3333-3333-333333333333")),
		UserID:         ptrUUID(uuid.MustParse("33333333-3333-3333-3333-333333333333")),
		CreatedAt:      now.Add(2 * time.Minute),
		LastProgressAt: ptrTime(now.Add(2 * time.Minute)),
	}

	mock.ExpectQuery(`SELECT .*FROM "scans" AS "scan".*DISTINCT ON.*latest_scan.*image_name.*image_tag.*owner_type.*created_at DESC.*`).
		WillReturnRows(scanRows(scanA, scanB))
	mock.ExpectQuery(`SELECT .*FROM compliance_results AS cr.*DISTINCT ON.*latest_scan.*image_name.*image_tag.*owner_type.*created_at DESC.*`).
		WillReturnRows(sqlmock.NewRows([]string{"scan_id", "policy_name", "evaluated_at"}))
	mock.ExpectQuery(`SELECT .*FROM vulnerabilities.*scan_id IN .*GROUP BY.*scan_id.*`).
		WillReturnRows(sqlmock.NewRows([]string{"scan_id", "fix_count", "critical_fix_count", "high_fix_count"}).
			AddRow(scanA.ID, 1, 0, 1).
			AddRow(scanB.ID, 1, 1, 0))
	mock.ExpectQuery(`SELECT .*FROM "watchlist_items" AS "watchlist_item".*`).
		WillReturnRows(sqlmock.NewRows(watchlistColumns()))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/triage", nil)
	ctx.Set(middlewares.AuthContextUserIDKey, uuid.MustParse("33333333-3333-3333-3333-333333333333"))
	ctx.Set(middlewares.AuthContextIsAdminKey, true)

	GetTriage(db)(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	var got response
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(got.Items) != 2 {
		t.Fatalf("expected two triage items for distinct tags, got %d", len(got.Items))
	}

	hrefs := map[string]bool{}
	for _, item := range got.Items {
		hrefs[item.Href] = true
	}
	foundA := false
	foundB := false
	for href := range hrefs {
		if strings.HasPrefix(href, "/scans/"+scanA.ID.String()) {
			foundA = true
		}
		if strings.HasPrefix(href, "/scans/"+scanB.ID.String()) {
			foundB = true
		}
	}
	if !foundA || !foundB {
		t.Fatalf("expected both tags to remain visible, got hrefs=%v", hrefs)
	}
	if got.Summary.Total != 2 || got.Summary.High != 2 {
		t.Fatalf("unexpected summary: %+v", got.Summary)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestGetTriageFixItemsUseAcknowledgementDrillIn(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	now := time.Date(2026, time.May, 30, 10, 0, 0, 0, time.UTC)
	scan := models.Scan{
		ID:             uuid.MustParse("cccccccc-cccc-cccc-cccc-cccccccccccc"),
		ImageName:      "ghcr.io/acme/api",
		ImageTag:       "2.0.0",
		Status:         models.ScanStatusCompleted,
		CriticalCount:  2,
		HighCount:      3,
		OwnerType:      models.OwnerTypeUser,
		OwnerUserID:    ptrUUID(uuid.MustParse("44444444-4444-4444-4444-444444444444")),
		UserID:         ptrUUID(uuid.MustParse("44444444-4444-4444-4444-444444444444")),
		CreatedAt:      now,
		CompletedAt:    ptrTime(now.Add(2 * time.Minute)),
		LastProgressAt: ptrTime(now.Add(2 * time.Minute)),
	}

	mock.ExpectQuery(`SELECT .*FROM "scans" AS "scan".*DISTINCT ON.*latest_scan.*image_name.*image_tag.*owner_type.*created_at DESC.*`).
		WillReturnRows(scanRows(scan))
	mock.ExpectQuery(`SELECT .*FROM compliance_results AS cr.*DISTINCT ON.*latest_scan.*image_name.*image_tag.*owner_type.*created_at DESC.*`).
		WillReturnRows(sqlmock.NewRows([]string{"scan_id", "policy_name", "evaluated_at"}))
	mock.ExpectQuery(`SELECT .*FROM vulnerabilities.*scan_id IN .*GROUP BY.*scan_id.*`).
		WillReturnRows(sqlmock.NewRows([]string{"scan_id", "fix_count", "critical_fix_count", "high_fix_count"}).
			AddRow(scan.ID, 4, 2, 2))
	mock.ExpectQuery(`SELECT .*FROM "watchlist_items" AS "watchlist_item".*`).
		WillReturnRows(sqlmock.NewRows(watchlistColumns()))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/triage", nil)
	ctx.Set(middlewares.AuthContextUserIDKey, uuid.MustParse("44444444-4444-4444-4444-444444444444"))
	ctx.Set(middlewares.AuthContextIsAdminKey, true)

	GetTriage(db)(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	var got response
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(got.Items) != 1 {
		t.Fatalf("expected one fix triage item, got %d", len(got.Items))
	}

	item := got.Items[0]
	if item.Kind != kindFix {
		t.Fatalf("expected fix item, got kind=%q", item.Kind)
	}
	if item.PrimaryAction != "Acknowledge findings" {
		t.Fatalf("expected acknowledge action, got %q", item.PrimaryAction)
	}

	target, err := url.Parse(item.Href)
	if err != nil {
		t.Fatalf("invalid href %q: %v", item.Href, err)
	}
	if target.Path != "/scans/"+scan.ID.String() {
		t.Fatalf("unexpected href path %q", target.Path)
	}
	query := target.Query()
	if query.Get("tab") != "vulns" {
		t.Fatalf("expected vulns tab, got %q", query.Get("tab"))
	}
	if query.Get("severity") != "CRITICAL,HIGH" {
		t.Fatalf("expected critical/high severity filter, got %q", query.Get("severity"))
	}
	if query.Get("has_fix") != "true" {
		t.Fatalf("expected has_fix=true, got %q", query.Get("has_fix"))
	}
	if query.Get("suppressed") != "false" {
		t.Fatalf("expected suppressed=false, got %q", query.Get("suppressed"))
	}
	if query.Get("sort_by") != "severity" || query.Get("sort_dir") != "desc" {
		t.Fatalf("unexpected sort settings: %s/%s", query.Get("sort_by"), query.Get("sort_dir"))
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func newMockBunDB(t *testing.T) (*bun.DB, sqlmock.Sqlmock, func()) {
	t.Helper()

	sqldb, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create sqlmock database: %v", err)
	}
	db := bun.NewDB(sqldb, pgdialect.New())
	db.RegisterModel((*models.ScanTag)(nil))
	db.RegisterModel((*models.OrgScan)(nil))
	db.RegisterModel((*models.StatusPageTarget)(nil))
	cleanup := func() {
		_ = db.Close()
		_ = sqldb.Close()
	}
	return db, mock, cleanup
}

func scanColumns() []string {
	return []string{
		"id",
		"image_name",
		"image_tag",
		"image_digest",
		"image_config",
		"scan_provider",
		"scan_source",
		"external_scan_id",
		"external_status",
		"current_step",
		"status",
		"error_message",
		"critical_count",
		"high_count",
		"medium_count",
		"low_count",
		"unknown_count",
		"suppressed_count",
		"trivy_version",
		"grype_version",
		"trivy_vuln_db_updated_at",
		"trivy_vuln_db_downloaded_at",
		"trivy_java_db_updated_at",
		"trivy_java_db_downloaded_at",
		"user_id",
		"owner_type",
		"owner_user_id",
		"owner_org_id",
		"registry_id",
		"architecture",
		"os_family",
		"os_name",
		"platform",
		"image_location",
		"started_at",
		"last_progress_at",
		"completed_at",
		"created_at",
		"share_token",
		"share_visibility",
		"helm_scan_run_id",
		"helm_chart",
		"helm_chart_name",
		"helm_chart_version",
		"helm_source_path",
	}
}

func scanRows(scans ...models.Scan) *sqlmock.Rows {
	rows := sqlmock.NewRows(scanColumns())
	for _, scan := range scans {
		rows.AddRow(
			scan.ID,
			scan.ImageName,
			scan.ImageTag,
			scan.ImageDigest,
			[]byte(`{}`),
			scan.ScanProvider,
			scan.ScanSource,
			scan.ExternalScanID,
			scan.ExternalStatus,
			scan.CurrentStep,
			scan.Status,
			scan.ErrorMessage,
			scan.CriticalCount,
			scan.HighCount,
			scan.MediumCount,
			scan.LowCount,
			scan.UnknownCount,
			scan.SuppressedCount,
			scan.TrivyVersion,
			scan.GrypeVersion,
			scan.TrivyVulnDBUpdatedAt,
			scan.TrivyVulnDBDownloadedAt,
			scan.TrivyJavaDBUpdatedAt,
			scan.TrivyJavaDBDownloadedAt,
			scan.UserID,
			scan.OwnerType,
			scan.OwnerUserID,
			scan.OwnerOrgID,
			scan.RegistryID,
			scan.Architecture,
			scan.OSFamily,
			scan.OSName,
			scan.Platform,
			scan.ImageLocation,
			scan.StartedAt,
			scan.LastProgressAt,
			scan.CompletedAt,
			scan.CreatedAt,
			scan.ShareToken,
			scan.ShareVisibility,
			scan.HelmScanRunID,
			scan.HelmChart,
			scan.HelmChartName,
			scan.HelmChartVersion,
			scan.HelmSourcePath,
		)
	}
	return rows
}

func watchlistColumns() []string {
	return []string{
		"id",
		"image_name",
		"image_tag",
		"schedule",
		"timezone",
		"enabled",
		"last_scan_id",
		"last_scanned_at",
		"registry_id",
		"tag_ids",
		"user_id",
		"owner_type",
		"owner_user_id",
		"owner_org_id",
		"created_at",
		"updated_at",
	}
}

func ptrUUID(value uuid.UUID) *uuid.UUID {
	return &value
}

func ptrTime(value time.Time) *time.Time {
	return &value
}
