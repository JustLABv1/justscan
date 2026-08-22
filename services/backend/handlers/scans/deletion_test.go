package scans

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

func TestScanDeletionExplicitlyRemovesFindingAndSBOMDependents(t *testing.T) {
	sqldb, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock database: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	for range 4 {
		mock.ExpectQuery("SELECT to_regclass").
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
		mock.ExpectExec("DELETE FROM").WillReturnResult(sqlmock.NewResult(0, 1))
	}
	mock.ExpectQuery("SELECT to_regclass").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec("DELETE FROM").WillReturnResult(sqlmock.NewResult(0, 1))

	scanIDs := []uuid.UUID{uuid.New(), uuid.New()}
	if err := deleteScanFindingDependents(context.Background(), db, scanIDs); err != nil {
		t.Fatalf("delete finding dependents: %v", err)
	}
	if err := deleteScanSBOMDependents(context.Background(), db, scanIDs); err != nil {
		t.Fatalf("delete SBOM dependents: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
