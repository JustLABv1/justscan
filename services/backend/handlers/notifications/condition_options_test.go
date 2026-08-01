package notifications

import (
	"net/http/httptest"
	"strings"
	"testing"

	"justscan-backend/middlewares"
	"justscan-backend/pkg/models"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

func TestNotificationConditionOptionScopeVisibility(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	orgID := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	tests := []struct {
		name           string
		optionCtx      notificationConditionOptionContext
		mustContain    []string
		mustNotContain []string
	}{
		{
			name: "personal scope includes owned and accessible organization scans",
			optionCtx: notificationConditionOptionContext{
				scope:            UserScope(userID),
				userID:           userID,
				accessibleOrgIDs: []uuid.UUID{orgID},
			},
			mustContain: []string{"s.user_id = ?", "s.owner_user_id = ?", "s.owner_org_id IN (?)", "org_scans"},
		},
		{
			name: "organization scope includes owned and shared scans",
			optionCtx: notificationConditionOptionContext{
				scope: OrgScope(orgID),
				orgID: orgID,
			},
			mustContain: []string{"s.owner_org_id = ?", "os.org_id = ?"},
		},
		{
			name: "system scope is unrestricted only for the system context",
			optionCtx: notificationConditionOptionContext{
				scope:   SystemScope(),
				isAdmin: true,
			},
			mustContain:    []string{"1 = 1"},
			mustNotContain: []string{"owner_org_id", "org_scans"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			clause, args := notificationScanVisibilityClause(test.optionCtx, "s")
			for _, expected := range test.mustContain {
				if !strings.Contains(clause, expected) {
					t.Fatalf("visibility clause %q does not contain %q", clause, expected)
				}
			}
			for _, unexpected := range test.mustNotContain {
				if strings.Contains(clause, unexpected) {
					t.Fatalf("visibility clause %q unexpectedly contains %q", clause, unexpected)
				}
			}
			if test.optionCtx.scope.Type == models.NotificationScopeSystem && len(args) != 0 {
				t.Fatalf("system scope should not require query arguments, got %v", args)
			}
		})
	}
}

func TestNotificationConditionOptionSearch(t *testing.T) {
	clause, args := notificationOptionSearch("prod", "name", "id::text")
	if clause != "(name ILIKE ? OR id::text ILIKE ?)" {
		t.Fatalf("search clause = %q", clause)
	}
	if len(args) != 2 || args[0] != "%prod%" || args[1] != "%prod%" {
		t.Fatalf("search args = %#v", args)
	}
}

func TestNotificationConditionOptionLookupScopes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	orgID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")

	tests := []struct {
		name       string
		scope      Scope
		setUser    bool
		setup      func(sqlmock.Sqlmock)
		wantStatus int
	}{
		{
			name:  "system",
			scope: SystemScope(),
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`(?s).*`).
					WillReturnRows(sqlmock.NewRows([]string{"value", "label", "description", "group_name"}).AddRow(orgID.String(), "Acme", "", "Organizations"))
			},
			wantStatus: 200,
		},
		{
			name:    "organization",
			scope:   OrgScope(orgID),
			setUser: true,
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`(?s).*`).
					WillReturnRows(sqlmock.NewRows([]string{"value", "label", "description", "group_name"}).AddRow(orgID.String(), "Acme", "", "Organizations"))
			},
			wantStatus: 200,
		},
		{
			name:    "personal",
			scope:   UserScope(userID),
			setUser: true,
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`(?s).*`).
					WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(orgID))
				mock.ExpectQuery(`(?s).*`).
					WillReturnRows(sqlmock.NewRows([]string{"value", "label", "description", "group_name"}).AddRow(orgID.String(), "Acme", "", "Organizations"))
			},
			wantStatus: 200,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db, mock, closeDB := newConditionOptionsMockDB(t)
			defer closeDB()
			test.setup(mock)

			request := httptest.NewRequest("GET", "/notifications/condition-options?field=org_id&limit=5", nil)
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = request
			if test.setUser {
				context.Set(middlewares.AuthContextUserIDKey, userID)
				context.Set(middlewares.AuthContextIsAdminKey, false)
			}

			ListConditionOptions(context, db, test.scope)
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("mock expectations: %v; body=%s", err, response.Body.String())
			}
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}
}

func TestNotificationEventValidationIncludesIntelligenceImpact(t *testing.T) {
	if !isAllowedNotificationEvent(models.NotificationEventIntelligencePolicyImpact) {
		t.Fatal("intelligence policy impact should be an allowed notification event")
	}
	if isAllowedNotificationEvent("unknown_event") {
		t.Fatal("unknown notification events should remain rejected")
	}
}

func newConditionOptionsMockDB(t *testing.T) (*bun.DB, sqlmock.Sqlmock, func()) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create sqlmock database: %v", err)
	}
	db := bun.NewDB(sqlDB, pgdialect.New())
	return db, mock, func() {
		_ = db.Close()
	}
}
