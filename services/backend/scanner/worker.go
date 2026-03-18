package scanner

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"justscan-backend/compliance"
	"justscan-backend/config"
	"justscan-backend/notifications"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// ScanJob represents a queued scan job
type ScanJob struct {
	ScanID   uuid.UUID
	DB       *bun.DB
	EnvVars  []string // optional registry credentials
	Platform string   // optional platform override (e.g. linux/arm64)
}

var jobQueue chan ScanJob

// InitWorker initializes the scan worker pool and starts it
func InitWorker(db *bun.DB) {
	concurrency := config.Config.Scanner.Concurrency
	if concurrency <= 0 {
		concurrency = 2
	}

	jobQueue = make(chan ScanJob, 64)

	for i := 0; i < concurrency; i++ {
		go workerLoop(i)
	}

	log.Infof("Scanner worker pool started with concurrency=%d", concurrency)
}

// EnqueueScan queues a scan job. The scan row must already exist in the DB with status=pending.
func EnqueueScan(scanID uuid.UUID, db *bun.DB, envVars []string, platform string) {
	jobQueue <- ScanJob{ScanID: scanID, DB: db, EnvVars: envVars, Platform: platform}
}

func workerLoop(id int) {
	log.Infof("Scanner worker %d ready", id)
	for job := range jobQueue {
		processScan(job)
	}
}

func processScan(job ScanJob) {
	ctx := context.Background()
	db := job.DB
	scanID := job.ScanID

	// Load the scan row
	scan := &models.Scan{}
	if err := db.NewSelect().Model(scan).Where("id = ?", scanID).Scan(ctx); err != nil {
		log.Errorf("Worker: failed to load scan %s: %v", scanID, err)
		return
	}

	// Mark as running
	now := time.Now()
	scan.Status = models.ScanStatusRunning
	scan.StartedAt = &now
	if _, err := db.NewUpdate().Model(scan).Column("status", "started_at").Where("id = ?", scanID).Exec(ctx); err != nil {
		log.Errorf("Worker: failed to update scan status to running: %v", err)
		return
	}

	log.Infof("Worker: starting scan %s for %s:%s", scanID, scan.ImageName, scan.ImageTag)

	// Run vulnerability scan
	trivyOut, trivyVersion, err := RunScan(ctx, scan.ImageName, scan.ImageTag, job.EnvVars, job.Platform)
	if err != nil {
		setFailed(ctx, db, scan, err.Error())
		return
	}

	// Parse and insert vulnerabilities
	vulns := ParseVulnerabilities(trivyOut, scanID)
	severityCounts := CountSeverities(vulns)

	if len(vulns) > 0 {
		for i := range vulns {
			vulns[i].ScanID = scanID
		}
		if _, err := db.NewInsert().Model(&vulns).Exec(ctx); err != nil {
			setFailed(ctx, db, scan, "failed to store vulnerabilities: "+err.Error())
			return
		}
	}

	// Run SBOM scan (best-effort, don't fail the whole scan if it errors)
	sbomOut, sbomErr := RunSBOMScan(ctx, scan.ImageName, scan.ImageTag, job.EnvVars, job.Platform)
	if sbomErr != nil {
		log.Warnf("Worker: SBOM scan failed for %s (non-fatal): %v", scanID, sbomErr)
	} else if sbomOut != nil {
		components := ParseSBOMComponents(sbomOut, scanID)
		if len(components) > 0 {
			for i := range components {
				components[i].ScanID = scanID
			}
			if _, err := db.NewInsert().Model(&components).Exec(ctx); err != nil {
				log.Warnf("Worker: failed to store SBOM components for %s: %v", scanID, err)
			}
		}
	}

	// Mark as completed
	completedAt := time.Now()
	scan.Status = models.ScanStatusCompleted
	scan.CompletedAt = &completedAt
	scan.TrivyVersion = trivyVersion
	scan.ImageDigest = ExtractDigest(trivyOut)
	if trivyOut.Metadata.ImageConfig != nil {
		scan.Architecture = trivyOut.Metadata.ImageConfig.Architecture
	}
	if trivyOut.Metadata.OS != nil {
		scan.OSFamily = trivyOut.Metadata.OS.Family
		scan.OSName = trivyOut.Metadata.OS.Name
	}
	scan.CriticalCount = severityCounts[models.SeverityCritical]
	scan.HighCount = severityCounts[models.SeverityHigh]
	scan.MediumCount = severityCounts[models.SeverityMedium]
	scan.LowCount = severityCounts[models.SeverityLow]
	scan.UnknownCount = severityCounts[models.SeverityUnknown]

	if _, err := db.NewUpdate().Model(scan).
		Column("status", "completed_at", "trivy_version", "image_digest",
			"critical_count", "high_count", "medium_count", "low_count", "unknown_count",
			"architecture", "os_family", "os_name").
		Where("id = ?", scanID).Exec(ctx); err != nil {
		log.Errorf("Worker: failed to mark scan %s as completed: %v", scanID, err)
		return
	}

	log.Infof("Worker: scan %s completed — CRIT:%d HIGH:%d MED:%d LOW:%d UNK:%d",
		scanID,
		scan.CriticalCount, scan.HighCount, scan.MediumCount, scan.LowCount, scan.UnknownCount)

	// Auto-assign to orgs by image pattern, then run compliance checks
	go compliance.AutoAssignOrgs(db, scan.ImageName, scan.ImageTag, scanID)

	// Apply auto-tag rules based on image name/tag patterns
	go applyAutoTags(db, scan)

	// Fire completion notification
	go notifications.Dispatch(db, models.NotificationEventScanComplete, notifications.Payload{
		ScanID:    scanID.String(),
		ImageName: scan.ImageName,
		ImageTag:  scan.ImageTag,
		Status:    models.ScanStatusCompleted,
		Details: fmt.Sprintf("Critical: %d  High: %d  Medium: %d  Low: %d",
			scan.CriticalCount, scan.HighCount, scan.MediumCount, scan.LowCount),
	})
}

func applyAutoTags(db *bun.DB, scan *models.Scan) {
	ctx := context.Background()
	var rules []models.AutoTagRule
	if err := db.NewSelect().Model(&rules).Scan(ctx); err != nil {
		return
	}

	imageFull := scan.ImageName + ":" + scan.ImageTag

	for _, rule := range rules {
		if matchesPattern(rule.Pattern, scan.ImageName) || matchesPattern(rule.Pattern, imageFull) {
			st := &models.ScanTag{ScanID: scan.ID, TagID: rule.TagID}
			db.NewInsert().Model(st).On("CONFLICT DO NOTHING").Exec(ctx) //nolint:errcheck
		}
	}
}

func matchesPattern(pattern, s string) bool {
	matched, _ := filepath.Match(strings.ToLower(pattern), strings.ToLower(s))
	return matched
}

func setFailed(ctx context.Context, db *bun.DB, scan *models.Scan, msg string) {
	log.Errorf("Worker: scan %s failed: %s", scan.ID, msg)
	scan.Status = models.ScanStatusFailed
	scan.ErrorMessage = msg
	completedAt := time.Now()
	scan.CompletedAt = &completedAt
	db.NewUpdate().Model(scan).
		Column("status", "error_message", "completed_at").
		Where("id = ?", scan.ID).Exec(ctx) //nolint:errcheck

	go notifications.Dispatch(db, models.NotificationEventScanFailed, notifications.Payload{
		ScanID:    scan.ID.String(),
		ImageName: scan.ImageName,
		ImageTag:  scan.ImageTag,
		Status:    models.ScanStatusFailed,
		Details:   msg,
	})
}
