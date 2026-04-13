package scanner

import (
	"context"
	"testing"
	"time"

	"justscan-backend/pkg/models"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

func TestUpsertKBEntriesNoopsForEmptySlice(t *testing.T) {
	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	if err := upsertKBEntries(context.Background(), db, nil); err != nil {
		t.Fatalf("upsertKBEntries returned error for empty slice: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected database interaction: %v", err)
	}
}

func TestUpsertKBEntriesExecutesUpsertForKBRows(t *testing.T) {
	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	entries := []models.VulnKBEntry{{
		VulnID:      "CVE-2026-1234",
		Description: "Test vulnerability",
		Severity:    models.SeverityHigh,
		CVSSScore:   7.8,
		CVSSVector:  "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N",
		References: []models.KBRef{{
			URL:    "https://nvd.nist.gov/vuln/detail/CVE-2026-1234",
			Source: "NVD",
		}},
	}}

	returnedAt := time.Date(2026, time.April, 13, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`INSERT INTO "vuln_kb"`).WillReturnRows(
		sqlmock.NewRows([]string{"published_date", "modified_date", "exploit_available", "fetched_at"}).
			AddRow(nil, nil, false, returnedAt),
	)

	if err := upsertKBEntries(context.Background(), db, entries); err != nil {
		t.Fatalf("upsertKBEntries returned error: %v", err)
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
