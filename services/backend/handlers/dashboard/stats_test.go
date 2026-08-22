package dashboard

import (
	"context"
	"net/http/httptest"
	"testing"

	"justscan-backend/pkg/models"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

func TestIsBlockedByXrayPolicyStatus(t *testing.T) {
	if !isBlockedByXrayPolicyStatus(models.ScanStatusFailed, models.ScanExternalStatusBlockedByXrayPolicy) {
		t.Fatal("expected blocked xray policy status to be detected")
	}
	if !isBlockedByXrayPolicyStatus(models.ScanStatusCompleted, models.ScanExternalStatusBlockedByXrayPolicy) {
		t.Fatal("expected external blocked status to count even when scan status is completed")
	}
	if isBlockedByXrayPolicyStatus(models.ScanStatusFailed, models.ScanStatusFailed) {
		t.Fatal("did not expect generic failures to be treated as blocked by policy")
	}
}

func TestCountsTowardDashboardFindings(t *testing.T) {
	if !countsTowardDashboardFindings(models.ScanStatusCompleted, "") {
		t.Fatal("expected completed scans to count toward dashboard findings")
	}
	if !countsTowardDashboardFindings(models.ScanStatusFailed, models.ScanExternalStatusBlockedByXrayPolicy) {
		t.Fatal("expected blocked-policy scans to count toward dashboard findings")
	}
	if countsTowardDashboardFindings(models.ScanStatusFailed, models.ScanStatusFailed) {
		t.Fatal("did not expect generic failures to count toward dashboard findings")
	}
	if !countsTowardDashboardFindings(models.ScanStatusCompleted, models.ScanExternalStatusBlockedByXrayPolicy) {
		t.Fatal("expected completed policy-blocked scans to count toward dashboard findings")
	}
}

func TestSummarizeActiveXrayScansUsesQueuedFallback(t *testing.T) {
	count, steps := summarizeActiveXrayScans([]models.Scan{
		{CurrentStep: models.ScanStepWaitingForXray},
		{CurrentStep: ""},
	})

	if count != 2 {
		t.Fatalf("expected 2 active xray scans, got %d", count)
	}
	if steps[models.ScanStepWaitingForXray] != 1 {
		t.Fatalf("expected waiting_for_xray step count of 1, got %d", steps[models.ScanStepWaitingForXray])
	}
	if steps[models.ScanStepQueued] != 1 {
		t.Fatalf("expected queued fallback step count of 1, got %d", steps[models.ScanStepQueued])
	}
}

func TestLoadIntelligenceIssueCountsScansAggregateColumns(t *testing.T) {
	sqldb, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock database: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	mock.ExpectQuery("SELECT").WillReturnRows(
		sqlmock.NewRows([]string{"changed", "pending"}).AddRow(4, 3),
	)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/api/v1/dashboard/stats", nil)
	counts, err := loadIntelligenceIssueCounts(c, context.Background(), db, uuid.Nil, true, nil)
	if err != nil {
		t.Fatalf("load intelligence counts: %v", err)
	}
	if counts.Changed != 4 || counts.Pending != 3 {
		t.Fatalf("intelligence counts = changed %d pending %d, want 4/3", counts.Changed, counts.Pending)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
