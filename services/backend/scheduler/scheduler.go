package scheduler

import (
	"context"
	"time"

	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/robfig/cron/v3"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

var cronRunner *cron.Cron

// Start initialises the cron scheduler and registers all enabled watchlist items.
func Start(db *bun.DB) {
	cronRunner = cron.New(cron.WithSeconds())
	// Load all enabled watchlist items and schedule them
	go func() {
		if err := loadAndSchedule(db); err != nil {
			log.Errorf("scheduler: initial load failed: %v", err)
		}
	}()
	cronRunner.Start()
	log.Info("Watchlist scheduler started")
}

// Stop gracefully shuts down the cron scheduler.
func Stop() {
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
	itemCopy := item // avoid closure capture
	_, err := cronRunner.AddFunc(item.Schedule, func() {
		log.Infof("scheduler: triggering scan for %s:%s", itemCopy.ImageName, itemCopy.ImageTag)
		scan := &models.Scan{
			ImageName: itemCopy.ImageName,
			ImageTag:  itemCopy.ImageTag,
			Status:    models.ScanStatusPending,
			UserID:    itemCopy.UserID,
			CreatedAt: time.Now(),
		}
		if _, err := db.NewInsert().Model(scan).Exec(context.Background()); err != nil {
			log.Errorf("scheduler: failed to create scan for %s: %v", itemCopy.ImageName, err)
			return
		}
		scanner.EnqueueScan(scan.ID, db, nil)
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
	}
}
