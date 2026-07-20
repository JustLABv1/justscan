package scans

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"justscan-backend/middlewares"
)

func TestGetQueueSummaryUsesPersonalScope(t *testing.T) {
	gin.SetMode(gin.TestMode)
	sqldb, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock database: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mock.ExpectQuery(`(?s)SELECT.*status = 'pending'.*current_step = 'queued'.*status = 'running'.*FROM scans AS s.*owner_user_id = '` + userID.String() + `'`).
		WillReturnRows(sqlmock.NewRows([]string{"queued_in_justscan", "active"}).AddRow(7, 2))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/scans/queue-summary?scope=personal", nil)
	ctx.Set(middlewares.AuthContextUserIDKey, userID)
	ctx.Set(middlewares.AuthContextIsAdminKey, true)

	GetQueueSummary(db)(ctx)

	if recorder.Code != http.StatusOK {
		if len(ctx.Errors) > 0 {
			t.Logf("queue summary query error: %v", ctx.Errors.Last().Err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("status = %d, want %d: %s; SQL expectations: %v", recorder.Code, http.StatusOK, recorder.Body.String(), err)
		}
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if !regexp.MustCompile(`"queued_in_justscan":7`).MatchString(recorder.Body.String()) ||
		!regexp.MustCompile(`"active":2`).MatchString(recorder.Body.String()) {
		t.Fatalf("unexpected response: %s", recorder.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestGetQueueSummaryUsesOrganizationScope(t *testing.T) {
	gin.SetMode(gin.TestMode)
	sqldb, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock database: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	orgID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	mock.ExpectQuery(`(?s)SELECT.*owner_org_id = '` + orgID.String() + `'.*os2.scan_id = s.id.*os2.org_id = '` + orgID.String() + `'`).
		WillReturnRows(sqlmock.NewRows([]string{"queued_in_justscan", "active"}).AddRow(3, 1))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/scans/queue-summary?scope="+orgID.String(), nil)
	ctx.Set(middlewares.AuthContextUserIDKey, userID)
	ctx.Set(middlewares.AuthContextIsAdminKey, true)

	GetQueueSummary(db)(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if !regexp.MustCompile(`"queued_in_justscan":3`).MatchString(recorder.Body.String()) ||
		!regexp.MustCompile(`"active":1`).MatchString(recorder.Body.String()) {
		t.Fatalf("unexpected response: %s", recorder.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}
