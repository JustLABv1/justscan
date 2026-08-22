package scans

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"justscan-backend/pkg/models"
)

func TestScanDeletionRemovesLinkedBackgroundJobs(t *testing.T) {
	sqldb, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock database: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	mock.ExpectExec(`(?s)DELETE FROM "background_jobs".*metadata.*scan_id.*resource_id.*payload`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	if err := deleteScanBackgroundJobs(context.Background(), db, []uuid.UUID{uuid.New()}); err != nil {
		t.Fatalf("delete linked background jobs: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestScanDeletionExplicitlyRemovesCurrentAndLegacyDependents(t *testing.T) {
	sqldb, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock database: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	for range 5 {
		mock.ExpectQuery("SELECT EXISTS").
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
		mock.ExpectExec("DELETE FROM").WillReturnResult(sqlmock.NewResult(0, 1))
	}
	for range 2 {
		mock.ExpectQuery("SELECT EXISTS").
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	}
	mock.ExpectExec("DELETE FROM").WillReturnResult(sqlmock.NewResult(0, 1))
	for range 3 {
		mock.ExpectQuery("SELECT EXISTS").
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	}
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

func TestClearScanReferencesSkipsMissingLegacyColumns(t *testing.T) {
	sqldb, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock database: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	mock.ExpectQuery("SELECT EXISTS").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery("SELECT EXISTS").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec("UPDATE git_repository_run_images").
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := clearScanReferences(context.Background(), db, []uuid.UUID{uuid.New()}); err != nil {
		t.Fatalf("clear scan references: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCleanupQueuedUploadedArchiveScanRemovesOnlyControlledDirectory(t *testing.T) {
	scanID := uuid.New()
	directory := archiveUploadDirectory(scanID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatalf("create upload directory: %v", err)
	}
	defer os.RemoveAll(directory)
	archivePath := filepath.Join(directory, "archive.tar")
	if err := os.WriteFile(archivePath, []byte("archive"), 0o600); err != nil {
		t.Fatalf("create upload file: %v", err)
	}

	scan := &models.Scan{
		ID:            scanID,
		ScanSource:    models.ScanSourceUploadedArchive,
		ImageLocation: archivePath,
		Status:        models.ScanStatusPending,
		CurrentStep:   models.ScanStepQueued,
	}
	if err := cleanupQueuedUploadedArchiveScan(scan); err != nil {
		t.Fatalf("cleanup controlled archive: %v", err)
	}
	if _, err := os.Stat(directory); !os.IsNotExist(err) {
		t.Fatalf("expected controlled upload directory to be removed, stat err=%v", err)
	}

	outside := filepath.Join(t.TempDir(), "must-survive.tar")
	if err := os.WriteFile(outside, []byte("keep"), 0o600); err != nil {
		t.Fatalf("create outside file: %v", err)
	}
	traversal := &models.Scan{
		ID:            uuid.New(),
		ScanSource:    models.ScanSourceUploadedArchive,
		ImageLocation: filepath.Join(archiveUploadDirectory(scanID), "..", "..", filepath.Base(outside)),
		Status:        models.ScanStatusPending,
		CurrentStep:   models.ScanStepQueued,
	}
	if err := cleanupQueuedUploadedArchiveScan(traversal); err != nil {
		t.Fatalf("unexpected traversal cleanup error: %v", err)
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("arbitrary path was removed: %v", err)
	}

	foreignID := uuid.New()
	foreignDirectory := archiveUploadDirectory(foreignID)
	if err := os.MkdirAll(foreignDirectory, 0o700); err != nil {
		t.Fatalf("create foreign upload directory: %v", err)
	}
	defer os.RemoveAll(foreignDirectory)
	foreignPath := filepath.Join(foreignDirectory, "foreign.tar")
	if err := os.WriteFile(foreignPath, []byte("keep"), 0o600); err != nil {
		t.Fatalf("create foreign upload: %v", err)
	}
	foreignScan := *scan
	foreignScan.ImageLocation = foreignPath
	if err := cleanupQueuedUploadedArchiveScan(&foreignScan); err != nil {
		t.Fatalf("unexpected foreign cleanup error: %v", err)
	}
	if _, err := os.Stat(foreignPath); err != nil {
		t.Fatalf("one-shot cleanup removed another scan's upload: %v", err)
	}
}

func TestCleanupArchiveUploadSessionsRemovesOnlyValidatedSessionDirectories(t *testing.T) {
	sessionID := uuid.New()
	directory := archiveUploadDirectory(sessionID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatalf("create session directory: %v", err)
	}
	defer os.RemoveAll(directory)
	archivePath := filepath.Join(directory, "archive.tar")
	if err := os.WriteFile(archivePath, []byte("archive"), 0o600); err != nil {
		t.Fatalf("create session archive: %v", err)
	}

	outside := filepath.Join(t.TempDir(), "must-survive.tar")
	if err := os.WriteFile(outside, []byte("keep"), 0o600); err != nil {
		t.Fatalf("create outside file: %v", err)
	}
	sessions := []models.ArchiveUploadSession{
		{ID: sessionID, ArchivePath: archivePath},
		{ID: uuid.New(), ArchivePath: outside},
	}
	if err := cleanupArchiveUploadSessions(sessions); err != nil {
		t.Fatalf("cleanup sessions: %v", err)
	}
	if _, err := os.Stat(directory); !os.IsNotExist(err) {
		t.Fatalf("expected validated session directory to be removed, stat err=%v", err)
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("arbitrary session path was removed: %v", err)
	}
}
