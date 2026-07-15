package orgs

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"justscan-backend/middlewares"
)

func TestUpdateOrgRequiresAdminRole(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	orgID := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	userID := uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	now := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)

	mock.ExpectQuery(`SELECT .* FROM "orgs".*WHERE .*id = .*`).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"name",
			"description",
			"is_active",
			"allow_image_scans",
			"allow_helm_scans",
			"allow_rescans",
			"allow_member_invites",
			"allow_org_tokens",
			"created_by_id",
			"created_at",
			"updated_at",
		}).AddRow(
			orgID,
			"Acme",
			"",
			true,
			true,
			true,
			true,
			true,
			true,
			uuid.MustParse("cccccccc-cccc-cccc-cccc-cccccccccccc"),
			now,
			now,
		))

	mock.ExpectQuery(`SELECT .* FROM "org_members".*org_id = .* AND user_id = .*`).
		WillReturnRows(sqlmock.NewRows([]string{
			"org_id",
			"user_id",
			"role",
			"joined_at",
			"created_at",
			"updated_at",
			"oidc_synced",
			"oidc_provider",
			"oidc_mapping_id",
		}).AddRow(
			orgID,
			userID,
			"viewer",
			now,
			now,
			now,
			false,
			"",
			nil,
		))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPut, "/orgs/"+orgID.String(), bytes.NewBufferString(`{"name":"new-name"}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Params = gin.Params{{Key: "id", Value: orgID.String()}}
	ctx.Set(middlewares.AuthContextUserIDKey, userID)
	ctx.Set(middlewares.AuthContextIsAdminKey, false)

	UpdateOrg(db)(ctx)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d, body=%s", recorder.Code, http.StatusForbidden, recorder.Body.String())
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
	cleanup := func() {
		_ = db.Close()
		_ = sqldb.Close()
	}
	return db, mock, cleanup
}
