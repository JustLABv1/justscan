package scanner

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

const (
	defaultScanCommandTimeout       = 2 * time.Hour
	defaultScanProgressHeartbeat    = 30 * time.Second
	defaultScanStaleTimeout         = 2 * time.Hour
	defaultScanWatchdogPoll         = time.Minute
	minimumScanWatchdogPoll         = 15 * time.Second
	defaultXraySummaryWaitWindow    = 15 * time.Minute
	defaultRegistryWarmupWaitWindow = 10 * time.Minute
)

func scanCommandTimeout() time.Duration {
	if config.Config != nil {
		if seconds := config.Config.Scanner.CommandTimeoutSeconds; seconds > 0 {
			return time.Duration(seconds) * time.Second
		}
		if seconds := config.Config.Scanner.Timeout; seconds > 0 {
			return time.Duration(seconds) * time.Second
		}
	}
	return defaultScanCommandTimeout
}

func scanProgressHeartbeatInterval() time.Duration {
	if config.Config != nil {
		if seconds := config.Config.Scanner.ProgressHeartbeatSeconds; seconds > 0 {
			return time.Duration(seconds) * time.Second
		}
	}
	return defaultScanProgressHeartbeat
}

func scanStaleTimeout() time.Duration {
	if config.Config != nil {
		if seconds := config.Config.Scanner.StaleTimeoutSeconds; seconds > 0 {
			return time.Duration(seconds) * time.Second
		}
	}
	return defaultScanStaleTimeout
}

func xraySummaryWaitWindow() time.Duration {
	waitWindow := scanStaleTimeout()
	if waitWindow <= 0 {
		return defaultXraySummaryWaitWindow
	}
	return waitWindow
}

func registryWarmupWaitWindow() time.Duration {
	waitWindow := scanStaleTimeout()
	if waitWindow <= 0 {
		return defaultRegistryWarmupWaitWindow
	}
	return waitWindow
}

func scanWatchdogPollInterval() time.Duration {
	interval := scanProgressHeartbeatInterval() * 2
	if interval <= 0 {
		interval = defaultScanWatchdogPoll
	}
	staleTimeout := scanStaleTimeout()
	if staleTimeout > 0 {
		maxInterval := staleTimeout / 4
		if maxInterval > 0 && interval > maxInterval {
			interval = maxInterval
		}
	}
	if interval < minimumScanWatchdogPoll {
		interval = minimumScanWatchdogPoll
	}
	return interval
}

func touchScanProgress(ctx context.Context, db *bun.DB, scanID uuid.UUID, progressedAt time.Time) error {
	if db == nil || scanID == uuid.Nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if progressedAt.IsZero() {
		progressedAt = time.Now()
	}
	if _, err := db.NewUpdate().Model((*models.Scan)(nil)).
		Set("last_progress_at = ?", progressedAt).
		Where("id = ?", scanID).
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to update last progress for scan %s: %w", scanID, err)
	}
	return nil
}

func startScanProgressHeartbeat(ctx context.Context, db *bun.DB, scanID uuid.UUID) func() {
	if db == nil || scanID == uuid.Nil {
		return func() {}
	}
	interval := scanProgressHeartbeatInterval()
	if interval <= 0 {
		return func() {}
	}

	if err := touchScanProgress(ctx, db, scanID, time.Now()); err != nil {
		log.Warnf("Scanner heartbeat failed to initialize for scan %s: %v", scanID, err)
	}

	stopCh := make(chan struct{})
	doneCh := make(chan struct{})
	var once sync.Once

	go func() {
		defer close(doneCh)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-stopCh:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := touchScanProgress(context.Background(), db, scanID, time.Now()); err != nil {
					log.Warnf("Scanner heartbeat failed for scan %s: %v", scanID, err)
				}
			}
		}
	}()

	return func() {
		once.Do(func() {
			close(stopCh)
			<-doneCh
		})
	}
}

func startScanStaleWatchdog(db *bun.DB) {
	if db == nil {
		return
	}
	staleTimeout := scanStaleTimeout()
	if staleTimeout <= 0 {
		log.Info("Scanner stale-scan watchdog disabled")
		return
	}
	pollInterval := scanWatchdogPollInterval()
	log.Infof("Scanner stale-scan watchdog enabled with stale_timeout=%s poll_interval=%s", staleTimeout, pollInterval)

	go func() {
		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()
		for {
			if err := failStaleScans(context.Background(), db, time.Now(), staleTimeout); err != nil {
				log.Warnf("Scanner stale-scan watchdog failed: %v", err)
			}
			<-ticker.C
		}
	}()
}

func failStaleScans(ctx context.Context, db *bun.DB, now time.Time, staleTimeout time.Duration) error {
	if db == nil || staleTimeout <= 0 {
		return nil
	}
	cutoff := now.Add(-staleTimeout)
	var scans []models.Scan
	if err := db.NewSelect().Model(&scans).
		Where("status IN (?)", bun.In([]string{models.ScanStatusPending, models.ScanStatusRunning})).
		Where("last_progress_at < ?", cutoff).
		Scan(ctx); err != nil {
		return fmt.Errorf("failed to query stale scans: %w", err)
	}

	for i := range scans {
		scan := &scans[i]
		if scan.Status == models.ScanStatusRunning {
			CancelScan(scan.ID)
		}
		setFailed(db, scan, staleScanFailureMessage(scan, staleTimeout, now))
	}
	return nil
}

func staleScanFailureMessage(scan *models.Scan, staleTimeout time.Duration, now time.Time) string {
	step := models.ScanStepQueued
	if scan != nil && strings.TrimSpace(scan.CurrentStep) != "" {
		step = scan.CurrentStep
	}
	message := fmt.Sprintf("scan timed out after %s without recorded progress while in %s", staleTimeout.Round(time.Second), strings.ReplaceAll(step, "_", " "))
	if scan != nil && scan.LastProgressAt != nil && !scan.LastProgressAt.IsZero() {
		message = fmt.Sprintf("%s (last progress %s ago)", message, now.Sub(*scan.LastProgressAt).Round(time.Second))
	}
	return message
}
