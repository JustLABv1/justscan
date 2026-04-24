package scanner

import (
	"testing"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/models"
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
