package backgroundjobs

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"justscan-backend/pkg/models"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

func TestSafeErrorRetainsPrivateCauseForLogs(t *testing.T) {
	private := errors.New("pq: relation secrets must not be shown")
	err := NewSafeError("The deletion could not be completed", private)
	var safe *SafeError
	if !errors.As(err, &safe) {
		t.Fatal("expected SafeError")
	}
	if safe.Public != "The deletion could not be completed" {
		t.Fatalf("public message = %q", safe.Public)
	}
	if !errors.Is(err, private) {
		t.Fatal("safe error should retain its private cause for logs")
	}
}

func TestBuildDedupeKeyIsBinarySafeAndComponentSensitive(t *testing.T) {
	left := BuildDedupeKey("scan", "a:b", "c")
	right := BuildDedupeKey("scan", "a", "b:c")
	if left == right {
		t.Fatal("different target components must not share a dedupe key")
	}
	if BuildDedupeKey("scan", "a:b", "c") != left {
		t.Fatal("dedupe key must be deterministic")
	}
}

func TestProcessorRegistrationReplacesAProcessorForTheSameType(t *testing.T) {
	jobType := "test-processor"
	first := func(_ context.Context, _ *bun.DB, _ *models.BackgroundJob) error { return nil }
	second := func(_ context.Context, _ *bun.DB, _ *models.BackgroundJob) error {
		return errors.New("second")
	}
	Register(jobType, first)
	Register(jobType, second)
	got, ok := processorFor(jobType)
	if !ok || got == nil {
		t.Fatal("expected registered processor")
	}
	if err := got(nil, nil, nil); err == nil || err.Error() != "second" {
		t.Fatalf("processor error = %v, want replacement", err)
	}
}

func TestClaimExcludesPassiveJobsAndUsesSkipLocked(t *testing.T) {
	sqldb, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	passiveType := "passive-test-job"
	RegisterPassive(passiveType)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT .*FROM "background_jobs".*type NOT IN.*FOR UPDATE SKIP LOCKED`).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectCommit()

	job, claimed, err := claim(context.Background(), db, "worker-test")
	if err != nil {
		t.Fatalf("claim returned error: %v", err)
	}
	if claimed || job != nil {
		t.Fatalf("claim = (%v, %v), want no claim", job, claimed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}
