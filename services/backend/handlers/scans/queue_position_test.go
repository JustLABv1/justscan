package scans

import (
	"net/http/httptest"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"justscan-backend/pkg/models"
)

func TestQueuePositionRanksVisibleProviderWorkBeforeFilteringRequestedIDs(t *testing.T) {
	for _, scope := range []string{"personal", "organization"} {
		t.Run(scope, func(t *testing.T) {
			sqldb, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			db := bun.NewDB(sqldb, pgdialect.New())
			defer db.Close()
			db.RegisterModel((*models.ScanTag)(nil))
			userID, orgID, scanID := uuid.New(), uuid.New(), uuid.New()
			urlScope := scope
			if scope == "organization" {
				urlScope = orgID.String()
			}
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest("GET", "/scans?scope="+urlScope, nil)
			// Visibility and workspace predicates must be inside the ranked subquery;
			// otherwise hidden scans leak through the numerical position.
			ownership := `scan.user_id = '` + userID.String() + `'.*scan.owner_user_id = '` + userID.String() + `'`
			workspace := `scan.owner_user_id = '` + userID.String() + `'`
			if scope == "organization" {
				workspace = `scan.owner_org_id = '` + orgID.String() + `'`
			}
			mock.ExpectQuery(`(?s)SELECT .* FROM \(SELECT .*ROW_NUMBER\(\) OVER \(PARTITION BY.*ORDER BY created_at, id\).*status = 'pending'.*` + ownership + `.*` + workspace + `.*\) AS ranked WHERE \(id IN`).WillReturnRows(sqlmock.NewRows([]string{"id", "position"}).AddRow(scanID, 4))
			scan := &models.Scan{ID: scanID, Status: models.ScanStatusPending}
			if err := attachQueuePositions(ctx, db, []*models.Scan{scan}, userID, false, []uuid.UUID{orgID}); err != nil {
				t.Fatal(err)
			}
			if scan.QueuePosition == nil || *scan.QueuePosition != 4 {
				t.Fatal("queue position not attached")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRunningScanHasNoQueuePositionQuery(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	if err := attachQueuePositions(ctx, nil, []*models.Scan{{Status: models.ScanStatusRunning}}, uuid.New(), false, nil); err != nil {
		t.Fatal(err)
	}
}
