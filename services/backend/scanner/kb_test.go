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
	mock.ExpectQuery(`SELECT .* FROM "vuln_kb" WHERE \(vuln_id IN \('CVE-2026-1234'\)\)`).WillReturnRows(
		sqlmock.NewRows([]string{"vuln_id", "description", "severity", "cvss_vector", "cvss_score", "published_date", "modified_date", "references", "exploit_available", "fetched_at"}),
	)
	mock.ExpectQuery(`INSERT INTO "vuln_kb".*description = EXCLUDED\.description.*severity = EXCLUDED\.severity.*cvss_score = EXCLUDED\.cvss_score.*published_date = EXCLUDED\.published_date.*exploit_available = EXCLUDED\.exploit_available.*fetched_at = EXCLUDED\.fetched_at`).WillReturnRows(
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

func TestPrepareKBEntriesForUpsertMergesExistingRows(t *testing.T) {
	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	fetchedAt := time.Date(2026, time.April, 14, 10, 30, 0, 0, time.UTC)
	publishedAt := time.Date(2026, time.April, 1, 0, 0, 0, 0, time.UTC)
	modifiedAt := time.Date(2026, time.April, 10, 0, 0, 0, 0, time.UTC)

	entries := []models.VulnKBEntry{{
		VulnID:      "CVE-2026-9999",
		Description: "New details from Xray",
		Severity:    models.SeverityHigh,
		CVSSScore:   8.8,
		CVSSVector:  "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
		References:  []models.KBRef{{URL: "https://example.com/new", Source: "Xray"}},
	}}

	mock.ExpectQuery(`SELECT .* FROM "vuln_kb" WHERE \(vuln_id IN \('CVE-2026-9999'\)\)`).WillReturnRows(
		sqlmock.NewRows([]string{"vuln_id", "description", "severity", "cvss_vector", "cvss_score", "published_date", "modified_date", "references", "exploit_available", "fetched_at"}).
			AddRow("CVE-2026-9999", "Existing KB description", models.SeverityMedium, "CVSS:3.1/old", 6.1, publishedAt, modifiedAt, `[{"url":"https://example.com/existing","source":"NVD"}]`, true, fetchedAt.Add(-time.Hour)),
	)

	prepared, err := prepareKBEntriesForUpsert(context.Background(), db, entries, fetchedAt)
	if err != nil {
		t.Fatalf("prepareKBEntriesForUpsert returned error: %v", err)
	}
	if len(prepared) != 1 {
		t.Fatalf("expected 1 prepared entry, got %d", len(prepared))
	}
	if prepared[0].Description != "Existing KB description" {
		t.Fatalf("expected longer existing description to be preserved, got %q", prepared[0].Description)
	}
	if prepared[0].Severity != models.SeverityHigh {
		t.Fatalf("expected higher incoming severity to win, got %q", prepared[0].Severity)
	}
	if prepared[0].CVSSScore != 8.8 {
		t.Fatalf("expected higher incoming score to win, got %v", prepared[0].CVSSScore)
	}
	if prepared[0].PublishedDate == nil || !prepared[0].PublishedDate.Equal(publishedAt) {
		t.Fatal("expected published date to be preserved")
	}
	if prepared[0].ModifiedDate == nil || !prepared[0].ModifiedDate.Equal(modifiedAt) {
		t.Fatal("expected modified date to be preserved")
	}
	if len(prepared[0].References) != 2 {
		t.Fatalf("expected merged references, got %d", len(prepared[0].References))
	}
	if !prepared[0].ExploitAvailable {
		t.Fatal("expected exploit_available to remain true")
	}
	if !prepared[0].FetchedAt.Equal(fetchedAt) {
		t.Fatalf("expected fetched_at %v, got %v", fetchedAt, prepared[0].FetchedAt)
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
