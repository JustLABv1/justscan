package migrations

import (
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

func TestAddScanDeletionIndexesSkipsMissingLegacyTable(t *testing.T) {
	sqldb, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	for _, index := range scanDeletionIndexes {
		exists := index.table != "compliance_history"
		mock.ExpectQuery(`SELECT EXISTS`).
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(exists))
		if exists {
			mock.ExpectExec(regexp.QuoteMeta(index.statement)).
				WillReturnResult(sqlmock.NewResult(0, 0))
		}
	}

	if err := addScanDeletionIndexes(context.Background(), db); err != nil {
		t.Fatalf("add scan deletion indexes: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}
