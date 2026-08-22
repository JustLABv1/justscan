package scanner

import (
	"context"
	"testing"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
)

func TestScanCommandTimeoutPrefersExplicitSetting(t *testing.T) {
	previous := config.Config
	config.Config = &config.RestfulConf{Scanner: config.ScannerConf{Timeout: 600, CommandTimeoutSeconds: 1800}}
	t.Cleanup(func() { config.Config = previous })

	if got := scanCommandTimeout(); got != 30*time.Minute {
		t.Fatalf("scanCommandTimeout() = %s, want 30m0s", got)
	}
}

func TestScanCommandTimeoutFallsBackToLegacyTimeout(t *testing.T) {
	previous := config.Config
	config.Config = &config.RestfulConf{Scanner: config.ScannerConf{Timeout: 900}}
	t.Cleanup(func() { config.Config = previous })

	if got := scanCommandTimeout(); got != 15*time.Minute {
		t.Fatalf("scanCommandTimeout() = %s, want 15m0s", got)
	}
}

func TestScanStaleTimeoutDefaults(t *testing.T) {
	previous := config.Config
	config.Config = &config.RestfulConf{}
	t.Cleanup(func() { config.Config = previous })

	if got := scanStaleTimeout(); got != defaultScanStaleTimeout {
		t.Fatalf("scanStaleTimeout() = %s, want %s", got, defaultScanStaleTimeout)
	}
}

func TestScanWatchdogPollIntervalRespectsHeartbeat(t *testing.T) {
	previous := config.Config
	config.Config = &config.RestfulConf{Scanner: config.ScannerConf{ProgressHeartbeatSeconds: 20, StaleTimeoutSeconds: 7200}}
	t.Cleanup(func() { config.Config = previous })

	if got := scanWatchdogPollInterval(); got != 40*time.Second {
		t.Fatalf("scanWatchdogPollInterval() = %s, want 40s", got)
	}
}

func TestStaleScanFailureMessageIncludesElapsedProgressGap(t *testing.T) {
	now := time.Date(2026, time.April, 13, 12, 0, 0, 0, time.UTC)
	lastProgress := now.Add(-5 * time.Minute)
	scan := &models.Scan{CurrentStep: models.ScanStepWaitingForXray, LastProgressAt: &lastProgress}

	message := staleScanFailureMessage(scan, 2*time.Hour, now)
	want := "scan timed out after 2h0m0s without recorded progress while in waiting for xray (last progress 5m0s ago)"
	if message != want {
		t.Fatalf("staleScanFailureMessage() = %q, want %q", message, want)
	}
}

func TestRecoverInterruptedScansLeavesPendingScansDurable(t *testing.T) {
	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	now := time.Date(2026, time.May, 4, 10, 30, 0, 0, time.UTC)
	runningID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	lastProgress := now.Add(-3 * time.Hour)

	mock.ExpectQuery(`SELECT .* FROM "scans" AS "scan" WHERE \(status = 'running'\).*last_progress_at IS NULL OR last_progress_at <`).WillReturnRows(
		sqlmock.NewRows([]string{"id", "scan_provider", "external_status", "current_step", "status", "last_progress_at"}).
			AddRow(runningID.String(), models.ScanProviderArtifactoryXray, "waiting_for_xray", models.ScanStepWaitingForXray, models.ScanStatusRunning, lastProgress),
	)

	mock.ExpectExec(`UPDATE "scans" AS "scan" SET .*"status" = 'failed'.*"current_step" = 'failed'.*"error_message" = 'scan interrupted because the backend restarted while in waiting for xray'.*"completed_at" = .*"last_progress_at" = .*"external_status" = 'failed'.*WHERE \(id = '22222222-2222-2222-2222-222222222222' AND status = 'running'\).*last_progress_at IS NULL OR last_progress_at <`).WillReturnResult(sqlmock.NewResult(0, 1))

	recovered, err := recoverInterruptedScans(context.TODO(), db, now)
	if err != nil {
		t.Fatalf("recoverInterruptedScans returned error: %v", err)
	}
	if recovered != 1 {
		t.Fatalf("recoverInterruptedScans() recovered %d scans, want 1 running scan", recovered)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}
