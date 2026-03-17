package scanner

import (
	"context"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// ScanJob represents a queued scan job
type ScanJob struct {
	ScanID  uuid.UUID
	DB      *bun.DB
	EnvVars []string // optional registry credentials
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
func EnqueueScan(scanID uuid.UUID, db *bun.DB, envVars []string) {
	jobQueue <- ScanJob{ScanID: scanID, DB: db, EnvVars: envVars}
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
	trivyOut, trivyVersion, err := RunScan(ctx, scan.ImageName, scan.ImageTag, job.EnvVars)
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
	sbomOut, sbomErr := RunSBOMScan(ctx, scan.ImageName, scan.ImageTag, job.EnvVars)
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
	scan.CriticalCount = severityCounts[models.SeverityCritical]
	scan.HighCount = severityCounts[models.SeverityHigh]
	scan.MediumCount = severityCounts[models.SeverityMedium]
	scan.LowCount = severityCounts[models.SeverityLow]
	scan.UnknownCount = severityCounts[models.SeverityUnknown]

	if _, err := db.NewUpdate().Model(scan).
		Column("status", "completed_at", "trivy_version", "image_digest",
			"critical_count", "high_count", "medium_count", "low_count", "unknown_count").
		Where("id = ?", scanID).Exec(ctx); err != nil {
		log.Errorf("Worker: failed to mark scan %s as completed: %v", scanID, err)
		return
	}

	log.Infof("Worker: scan %s completed — CRIT:%d HIGH:%d MED:%d LOW:%d UNK:%d",
		scanID,
		scan.CriticalCount, scan.HighCount, scan.MediumCount, scan.LowCount, scan.UnknownCount)
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
}
