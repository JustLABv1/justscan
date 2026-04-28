package scheduler

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/google/uuid"
	"github.com/robfig/cron/v3"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

var cronRunner *cron.Cron
var scheduleMu sync.Mutex
var scheduledEntries map[string]cron.EntryID

// Start initialises the cron scheduler and registers all enabled watchlist items.
func Start(db *bun.DB) {
	cronRunner = cron.New()
	scheduledEntries = make(map[string]cron.EntryID)
	// Load all enabled watchlist items and schedule them
	go func() {
		if err := loadAndSchedule(db); err != nil {
			log.Errorf("scheduler: initial load failed: %v", err)
		}
	}()
	// Daily cleanup of insight logs older than configured retention.
	go startInsightLogCleanup(db)
	cronRunner.Start()
	log.Info("Watchlist scheduler started")
}

// Stop gracefully shuts down the cron scheduler.
func Stop() {
	scheduleMu.Lock()
	scheduledEntries = make(map[string]cron.EntryID)
	scheduleMu.Unlock()
	if cronRunner != nil {
		ctx := cronRunner.Stop()
		select {
		case <-ctx.Done():
		case <-time.After(10 * time.Second):
		}
	}
}

func loadAndSchedule(db *bun.DB) error {
	var items []models.WatchlistItem
	if err := db.NewSelect().Model(&items).Where("enabled = true").Scan(context.Background()); err != nil {
		return err
	}
	for _, item := range items {
		scheduleItem(db, item)
	}
	log.Infof("scheduler: loaded %d watchlist items", len(items))
	return nil
}

func scheduleItem(db *bun.DB, item models.WatchlistItem) {
	scheduleMu.Lock()
	if existing, ok := scheduledEntries[item.ID.String()]; ok && cronRunner != nil {
		cronRunner.Remove(existing)
	}
	scheduleMu.Unlock()

	itemCopy := item // avoid closure capture
	spec, err := buildCronSpec(item.Schedule, item.Timezone)
	if err != nil {
		log.Errorf("scheduler: invalid schedule for item %s: %v", item.ID, err)
		return
	}
	entryID, err := cronRunner.AddFunc(spec, func() {
		log.Infof("scheduler: triggering scan for %s:%s", itemCopy.ImageName, itemCopy.ImageTag)
		registry, envVars, err := scanner.ResolveRegistryForScan(context.Background(), db, itemCopy.ImageName, itemCopy.RegistryID)
		if err != nil {
			log.Errorf("scheduler: failed to resolve registry for %s:%s: %v", itemCopy.ImageName, itemCopy.ImageTag, err)
			return
		}
		provider, err := scanner.ProviderForRegistry(registry)
		if err != nil {
			log.Errorf("scheduler: unavailable provider for %s:%s: %v", itemCopy.ImageName, itemCopy.ImageTag, err)
			return
		}
		normalizedImageName, normalizedImageTag := scanner.NormalizeScanTarget(itemCopy.ImageName, itemCopy.ImageTag, registry)
		scan := newScheduledScan(itemCopy, normalizedImageName, normalizedImageTag, provider, itemCopy.RegistryID, time.Now())
		if registry != nil {
			scan.RegistryID = &registry.ID
		}
		if err := db.RunInTx(context.Background(), nil, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.NewInsert().Model(scan).Exec(ctx); err != nil {
				return err
			}
			if scan.OwnerOrgID != nil {
				if err := ensureOrgScanLink(ctx, tx, *scan.OwnerOrgID, scan.ID); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			log.Errorf("scheduler: failed to create scan for %s: %v", itemCopy.ImageName, err)
			return
		}
		if err := scanner.DispatchScan(context.Background(), db, scan, envVars, ""); err != nil {
			log.Warnf("scheduler: dispatch failed for %s: %v", scan.ID, err)
			if markErr := scanner.MarkScanFailed(context.Background(), db, scan.ID, err.Error()); markErr != nil {
				log.Errorf("scheduler: failed to persist dispatch error for %s: %v", scan.ID, markErr)
			}
		}
		now := time.Now()
		itemCopy.LastScannedAt = &now
		itemCopy.LastScanID = &scan.ID
		db.NewUpdate().Model(&itemCopy).
			Column("last_scanned_at", "last_scan_id").
			Where("id = ?", itemCopy.ID).
			Exec(context.Background()) //nolint:errcheck
	})
	if err != nil {
		log.Errorf("scheduler: invalid cron schedule %q for item %s: %v", item.Schedule, item.ID, err)
		return
	}
	scheduleMu.Lock()
	scheduledEntries[item.ID.String()] = entryID
	scheduleMu.Unlock()
}

func newScheduledScan(item models.WatchlistItem, imageName string, imageTag string, provider string, registryID *uuid.UUID, createdAt time.Time) *models.Scan {
	ownerType := item.OwnerType
	if ownerType != models.OwnerTypeOrg && ownerType != models.OwnerTypeUser {
		ownerType = models.OwnerTypeUser
	}
	ownerUserID := item.OwnerUserID
	ownerOrgID := item.OwnerOrgID
	if ownerType == models.OwnerTypeOrg && ownerOrgID == nil {
		ownerType = models.OwnerTypeUser
	}
	if ownerType == models.OwnerTypeUser && ownerUserID == nil {
		ownerUserID = &item.UserID
	}
	if ownerType == models.OwnerTypeOrg {
		ownerUserID = nil
	}

	return &models.Scan{
		ImageName:    imageName,
		ImageTag:     imageTag,
		RegistryID:   registryID,
		ScanProvider: provider,
		CurrentStep:  models.ScanStepQueued,
		Status:       models.ScanStatusPending,
		UserID:       &item.UserID,
		OwnerType:    ownerType,
		OwnerUserID:  ownerUserID,
		OwnerOrgID:   ownerOrgID,
		CreatedAt:    createdAt,
	}
}

func ensureOrgScanLink(ctx context.Context, db bun.IDB, orgID uuid.UUID, scanID uuid.UUID) error {
	_, err := db.NewInsert().Model(&models.OrgScan{OrgID: orgID, ScanID: scanID}).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}

func SyncWatchlistItem(db *bun.DB, item models.WatchlistItem) {
	if cronRunner == nil {
		return
	}
	if !item.Enabled {
		UnscheduleWatchlistItem(item.ID.String())
		return
	}
	scheduleItem(db, item)
}

func UnscheduleWatchlistItem(itemID string) {
	if cronRunner == nil {
		return
	}
	scheduleMu.Lock()
	defer scheduleMu.Unlock()
	if entryID, ok := scheduledEntries[itemID]; ok {
		cronRunner.Remove(entryID)
		delete(scheduledEntries, itemID)
	}
}

func ValidateSchedule(schedule string, timezone string) error {
	_, err := buildCronSpec(schedule, timezone)
	return err
}

func buildCronSpec(schedule string, timezone string) (string, error) {
	trimmedSchedule := strings.TrimSpace(schedule)
	if trimmedSchedule == "" {
		return "", fmt.Errorf("schedule is required")
	}
	trimmedTimezone := strings.TrimSpace(timezone)
	if trimmedTimezone == "" {
		trimmedTimezone = "UTC"
	}
	if _, err := time.LoadLocation(trimmedTimezone); err != nil {
		return "", fmt.Errorf("invalid timezone %q", trimmedTimezone)
	}
	if _, err := cron.ParseStandard(trimmedSchedule); err != nil {
		return "", fmt.Errorf("invalid cron expression: %w", err)
	}
	return fmt.Sprintf("CRON_TZ=%s %s", trimmedTimezone, trimmedSchedule), nil
}

// startInsightLogCleanup runs once at startup and then every 24 hours to prune
// api_request_logs and xray_request_logs that are older than their configured
// retention window.
func startInsightLogCleanup(db *bun.DB) {
	runCleanup := func() {
		ctx := context.Background()

		// Read current retention settings.
		apiDays := settingInt(ctx, db, "api_log_retention_days", 30)
		xrayDays := settingInt(ctx, db, "xray_log_retention_days", 30)

		if apiDays > 0 {
			cutoff := time.Now().AddDate(0, 0, -apiDays)
			res, err := db.NewDelete().TableExpr("api_request_logs").Where("created_at < ?", cutoff).Exec(ctx)
			if err != nil {
				log.Warnf("insight cleanup: failed to prune api_request_logs: %v", err)
			} else if n, _ := res.RowsAffected(); n > 0 {
				log.Infof("insight cleanup: pruned %d api_request_logs older than %d days", n, apiDays)
			}
		}

		if xrayDays > 0 {
			cutoff := time.Now().AddDate(0, 0, -xrayDays)
			res, err := db.NewDelete().TableExpr("xray_request_logs").Where("created_at < ?", cutoff).Exec(ctx)
			if err != nil {
				log.Warnf("insight cleanup: failed to prune xray_request_logs: %v", err)
			} else if n, _ := res.RowsAffected(); n > 0 {
				log.Infof("insight cleanup: pruned %d xray_request_logs older than %d days", n, xrayDays)
			}
		}
	}

	// Run immediately, then every 24 hours.
	runCleanup()
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		runCleanup()
	}
}

// settingInt reads a system_settings integer value with a fallback default.
func settingInt(ctx context.Context, db *bun.DB, key string, defaultVal int) int {
	var s models.SystemSetting
	if err := db.NewSelect().Model(&s).Where("key = ?", key).Scan(ctx); err != nil {
		return defaultVal
	}
	var v int
	fmt.Sscanf(s.Value, "%d", &v)
	if v <= 0 {
		return defaultVal
	}
	return v
}
