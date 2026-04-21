package authz

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"justscan-backend/middlewares"
	"justscan-backend/pkg/models"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

func TestLoadAccessibleRegistryAllowsSystemRegistryForNormalUser(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	registryID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	createdByID := uuid.MustParse("33333333-3333-3333-3333-333333333333")

	mock.ExpectQuery(`SELECT .* FROM "registries".*WHERE .*id = .*`).WillReturnRows(registryRow(models.Registry{
		ID:                registryID,
		Name:              "global-default",
		URL:               "https://registry.example.com",
		XrayArtifactoryID: "default",
		AuthType:          models.RegistryAuthNone,
		ScanProvider:      models.ScanProviderTrivy,
		CreatedByID:       createdByID,
		OwnerType:         models.OwnerTypeSystem,
		CreatedAt:         time.Date(2026, time.April, 21, 10, 0, 0, 0, time.UTC),
		UpdatedAt:         time.Date(2026, time.April, 21, 10, 0, 0, 0, time.UTC),
	}))

	c, _ := newAuthedContext(userID, false)
	registry, returnedUserID, isAdmin, ok := LoadAccessibleRegistry(c, db, registryID)
	if !ok {
		t.Fatal("expected system registry to be accessible")
	}
	if isAdmin {
		t.Fatal("expected non-admin user")
	}
	if returnedUserID != userID {
		t.Fatalf("expected user id %s, got %s", userID, returnedUserID)
	}
	if registry == nil || registry.ID != registryID {
		t.Fatalf("expected registry %s, got %#v", registryID, registry)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestLoadAccessibleRegistryAllowsOrgSharedRegistryForViewer(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	userID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	registryID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	sharedOrgID := uuid.MustParse("66666666-6666-6666-6666-666666666666")
	ownerOrgID := uuid.MustParse("77777777-7777-7777-7777-777777777777")
	createdByID := uuid.MustParse("88888888-8888-8888-8888-888888888888")

	mock.ExpectQuery(`SELECT .* FROM "registries".*WHERE .*id = .*`).WillReturnRows(registryRow(models.Registry{
		ID:                registryID,
		Name:              "shared-registry",
		URL:               "https://registry.example.com",
		XrayArtifactoryID: "default",
		AuthType:          models.RegistryAuthNone,
		ScanProvider:      models.ScanProviderTrivy,
		CreatedByID:       createdByID,
		OwnerType:         models.OwnerTypeOrg,
		OwnerOrgID:        &ownerOrgID,
		CreatedAt:         time.Date(2026, time.April, 21, 10, 0, 0, 0, time.UTC),
		UpdatedAt:         time.Date(2026, time.April, 21, 10, 0, 0, 0, time.UTC),
	}))
	mock.ExpectQuery(`SELECT DISTINCT o\.id.*FROM orgs o.*LEFT JOIN org_members om.*WHERE o\.created_by_id = .* OR om\.user_id = .*`).WillReturnRows(
		sqlmock.NewRows([]string{"id"}).AddRow(sharedOrgID),
	)
	mock.ExpectQuery(`SELECT EXISTS \(SELECT .* FROM "org_registries".*registry_id = .*org_id IN .*\)`).WillReturnRows(
		sqlmock.NewRows([]string{"exists"}).AddRow(true),
	)

	c, _ := newAuthedContext(userID, false)
	registry, _, _, ok := LoadAccessibleRegistry(c, db, registryID)
	if !ok {
		t.Fatal("expected shared registry to be accessible")
	}
	if registry == nil || registry.ID != registryID {
		t.Fatalf("expected registry %s, got %#v", registryID, registry)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestLoadAuthorizedRegistryStillRejectsSystemRegistryForNormalUser(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	userID := uuid.MustParse("99999999-9999-9999-9999-999999999999")
	registryID := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	createdByID := uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")

	mock.ExpectQuery(`SELECT .* FROM "registries".*WHERE .*id = .*`).WillReturnRows(registryRow(models.Registry{
		ID:                registryID,
		Name:              "global-default",
		URL:               "https://registry.example.com",
		XrayArtifactoryID: "default",
		AuthType:          models.RegistryAuthNone,
		ScanProvider:      models.ScanProviderTrivy,
		CreatedByID:       createdByID,
		OwnerType:         models.OwnerTypeSystem,
		CreatedAt:         time.Date(2026, time.April, 21, 10, 0, 0, 0, time.UTC),
		UpdatedAt:         time.Date(2026, time.April, 21, 10, 0, 0, 0, time.UTC),
	}))

	c, recorder := newAuthedContext(userID, false)
	if _, _, _, ok := LoadAuthorizedRegistry(c, db, registryID); ok {
		t.Fatal("expected write-level helper to reject system registry for non-admin")
	}
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d", http.StatusNotFound, recorder.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func newAuthedContext(userID uuid.UUID, isAdmin bool) (*gin.Context, *httptest.ResponseRecorder) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	c.Set(middlewares.AuthContextUserIDKey, userID)
	c.Set(middlewares.AuthContextIsAdminKey, isAdmin)
	return c, recorder
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

func registryRow(registry models.Registry) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"name",
		"url",
		"xray_url",
		"xray_artifactory_id",
		"auth_type",
		"scan_provider",
		"username",
		"password",
		"created_by_id",
		"owner_type",
		"owner_user_id",
		"owner_org_id",
		"created_at",
		"updated_at",
		"health_status",
		"health_message",
		"last_health_check_at",
		"is_default",
	}).AddRow(
		registry.ID,
		registry.Name,
		registry.URL,
		registry.XrayURL,
		registry.XrayArtifactoryID,
		registry.AuthType,
		registry.ScanProvider,
		registry.Username,
		registry.Password,
		registry.CreatedByID,
		registry.OwnerType,
		registry.OwnerUserID,
		registry.OwnerOrgID,
		registry.CreatedAt,
		registry.UpdatedAt,
		registry.HealthStatus,
		registry.HealthMessage,
		registry.LastHealthCheckAt,
		registry.IsDefault,
	)
}
