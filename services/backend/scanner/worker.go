package scanner

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
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

// cancelMap stores cancel functions for in-progress scans so they can be interrupted.
var (
	cancelMap = make(map[uuid.UUID]context.CancelFunc)
	cancelMu  sync.Mutex
)

// CancelScan signals a running scan to stop. Returns true if the scan was found
// and cancelled, false if it was not currently running (already queued/done).
func CancelScan(scanID uuid.UUID) bool {
	cancelMu.Lock()
	defer cancelMu.Unlock()
	if fn, ok := cancelMap[scanID]; ok {
		fn()
		delete(cancelMap, scanID)
		return true
	}
	return false
}

// InitWorker initializes the scan worker pool and starts it
func InitWorker(db *bun.DB) {
	concurrency := config.Config.Scanner.Concurrency
	if concurrency <= 0 {
		concurrency = 2
	}

	jobQueue = make(chan ScanJob, 64)

	for i := 0; i < concurrency; i++ {
		cacheDir := workerCacheDir(i)
		if err := os.MkdirAll(cacheDir, 0o755); err != nil {
			log.Warnf("Scanner worker %d cache init failed: %v", i, err)
		}
		if config.Config.Scanner.EnableGrype {
			if err := os.MkdirAll(workerGrypeCacheDir(cacheDir), 0o755); err != nil {
				log.Warnf("Scanner worker %d grype cache init failed: %v", i, err)
			}
		}
		go func(workerID int, dir string) {
			info, err := EnsureDatabasesFresh(context.Background(), dir)
			if err != nil {
				log.Warnf("Scanner worker %d trivy DB warmup failed: %v", workerID, err)
				return
			}
			if info != nil && info.VulnerabilityDB.UpdatedAt != nil {
				log.Infof("Scanner worker %d trivy DB ready (vuln updated %s)", workerID, info.VulnerabilityDB.UpdatedAt.Format(time.RFC3339))
			}
		}(i, cacheDir)
		go workerLoop(i)
	}

	log.Infof("Scanner worker pool started with concurrency=%d", concurrency)

	// Periodically refresh trivy databases for all workers so they stay current
	// even when no scans are running (e.g. after a startup where the initial
	// warmup failed due to the network not being ready yet).
	go func() {
		refreshInterval := time.Duration(config.Config.Scanner.DBMaxAgeHours) * time.Hour
		if refreshInterval <= 0 {
			refreshInterval = 12 * time.Hour
		}
		ticker := time.NewTicker(refreshInterval)
		defer ticker.Stop()
		for range ticker.C {
			for i := 0; i < concurrency; i++ {
				dir := workerCacheDir(i)
				if _, err := EnsureDatabasesFresh(context.Background(), dir); err != nil {
					log.Warnf("Periodic DB refresh for worker %d failed: %v", i, err)
				} else {
					log.Infof("Periodic DB refresh for worker %d completed", i)
				}
			}
		}
	}()

	// Backfill vuln_kb from existing vulnerabilities (best-effort, runs once in background)
	go backfillKB(db)
}

// EnqueueScan queues a scan job. The scan row must already exist in the DB with status=pending.
func EnqueueScan(scanID uuid.UUID, db *bun.DB, envVars []string, platform string) error {
	if err := setScanStepByID(context.Background(), db, scanID, models.ScanStepQueued); err != nil {
		return err
	}
	recordScanStepOutput(context.Background(), db, scanID, "Scan accepted and queued for execution.")
	jobQueue <- ScanJob{ScanID: scanID, DB: db, EnvVars: envVars, Platform: platform}
	return nil
}

func workerLoop(id int) {
	log.Infof("Scanner worker %d ready", id)
	cacheDir := workerCacheDir(id)
	for job := range jobQueue {
		processScan(job, cacheDir)
	}
}

func processScan(job ScanJob, cacheDir string) {
	db := job.DB
	scanID := job.ScanID

	// Load the scan row
	scan := &models.Scan{}
	if err := db.NewSelect().Model(scan).Where("id = ?", scanID).Scan(context.Background()); err != nil {
		log.Errorf("Worker: failed to load scan %s: %v", scanID, err)
		return
	}

	// If the scan was cancelled before a worker picked it up, skip processing.
	if scan.Status == models.ScanStatusCancelled {
		log.Infof("Worker: scan %s was cancelled before processing, skipping", scanID)
		return
	}

	// Create a cancellable context so this scan can be interrupted via CancelScan().
	ctx, cancel := context.WithCancel(context.Background())
	cancelMu.Lock()
	cancelMap[scanID] = cancel
	cancelMu.Unlock()
	defer func() {
		cancel()
		cancelMu.Lock()
		delete(cancelMap, scanID)
		cancelMu.Unlock()
	}()

	// Mark as running
	now := time.Now()
	scan.Status = models.ScanStatusRunning
	scan.StartedAt = &now
	if _, err := db.NewUpdate().Model(scan).Column("status", "started_at").Where("id = ?", scanID).Exec(ctx); err != nil {
		log.Errorf("Worker: failed to update scan status to running: %v", err)
		return
	}

	log.Infof("Worker: starting scan %s for %s:%s", scanID, scan.ImageName, scan.ImageTag)

	if scan.ScanProvider == models.ScanProviderArtifactoryXray {
		recordScanStepOutput(ctx, db, scanID, "Worker started and handed off to the Xray provider flow.")
		if err := processXrayScan(ctx, db, scan); err != nil {
			if ctx.Err() != nil {
				return
			}
			setFailed(db, scan, err.Error())
			return
		}

		log.Infof("Worker: xray scan %s completed — CRIT:%d HIGH:%d MED:%d LOW:%d UNK:%d",
			scanID,
			scan.CriticalCount, scan.HighCount, scan.MediumCount, scan.LowCount, scan.UnknownCount)
		return
	}

	if err := setScanStep(ctx, db, scan, models.ScanStepPreparingImage); err != nil {
		setFailed(db, scan, err.Error())
		return
	}
	recordScanStepOutput(ctx, db, scanID, "Worker started and is preparing the local scan environment.")

	runtimeInfo, err := EnsureDatabasesFresh(ctx, cacheDir)
	if err != nil {
		setFailed(db, scan, "failed to refresh trivy databases: "+err.Error())
		return
	}
	recordScanStepOutput(ctx, db, scanID, "Scanner databases are ready for this run.")
	if err := setScanStep(ctx, db, scan, models.ScanStepScanningImage); err != nil {
		setFailed(db, scan, err.Error())
		return
	}
	recordScanStepOutput(ctx, db, scanID, "Starting the image analysis with Trivy.")

	// Run vulnerability scan
	trivyOut, trivyVersion, err := RunScanWithRegistryRetry(ctx, db, scan, job.EnvVars, job.Platform, cacheDir)
	if err != nil {
		if ctx.Err() != nil {
			// Context was cancelled — scan was interrupted by user
			log.Infof("Worker: scan %s was cancelled", scanID)
			// Status is already set to cancelled by the cancel handler; just return.
			return
		}
		setFailed(db, scan, err.Error())
		return
	}
	if err := setScanStep(ctx, db, scan, models.ScanStepProcessingResults); err != nil {
		setFailed(db, scan, err.Error())
		return
	}
	recordScanStepOutput(ctx, db, scanID, "Trivy scan finished. Processing and normalizing findings.")

	// Parse and insert vulnerabilities
	vulns := ParseVulnerabilities(trivyOut, scanID)
	grypeVersion := ""
	kbEntries := ExtractKBEntries(trivyOut)
	if config.Config.Scanner.EnableGrype {
		grypeOut, version, grypeErr := RunGrypeScan(ctx, scan.ImageName, scan.ImageTag, job.EnvVars, job.Platform, cacheDir)
		if grypeErr != nil {
			if ctx.Err() == nil {
				log.Warnf("Worker: Grype scan failed for %s (non-fatal): %v", scanID, grypeErr)
			}
		} else if grypeOut != nil {
			grypeVersion = version
			beforeCount := len(vulns)
			vulns = MergeLocalScannerFindings(vulns, ParseGrypeVulnerabilities(grypeOut, scanID))
			addedCount := len(vulns) - beforeCount
			if addedCount > 0 {
				log.Infof("Worker: Grype added %d unique findings for scan %s", addedCount, scanID)
				recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Grype contributed %d additional unique findings.", addedCount))
			} else {
				recordScanStepOutput(ctx, db, scanID, "Grype completed without adding unique findings beyond Trivy.")
			}
			kbEntries = MergeKBEntries(kbEntries, ExtractGrypeKBEntries(grypeOut))
		}
	}

	if len(vulns) > 0 {
		for i := range vulns {
			vulns[i].ScanID = scanID
		}
		if _, err := db.NewInsert().Model(&vulns).Exec(ctx); err != nil {
			setFailed(db, scan, "failed to store vulnerabilities: "+err.Error())
			return
		}
		recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Stored %d vulnerability findings.", len(vulns)))
	} else {
		recordScanStepOutput(ctx, db, scanID, "No vulnerability findings were produced by the local scanners.")
	}

	// Upsert KB entries from scan data (best-effort, non-fatal)
	go func(entries []models.VulnKBEntry) {
		if len(entries) == 0 {
			return
		}
		if err := upsertKBEntries(context.Background(), db, entries); err != nil {
			log.Warnf("Worker: KB upsert failed for scan %s (non-fatal): %v", scanID, err)
		} else {
			log.Debugf("Worker: upserted %d KB entries for scan %s", len(entries), scanID)
		}
	}(kbEntries)

	var osvVulns []models.Vulnerability
	if err := setScanStep(ctx, db, scan, models.ScanStepFinalizingReport); err != nil {
		setFailed(db, scan, err.Error())
		return
	}
	recordScanStepOutput(ctx, db, scanID, "Finalizing the report and running post-processing steps.")

	// Run SBOM scan (best-effort, don't fail the whole scan if it errors)
	sbomOut, sbomErr := RunSBOMScan(ctx, scan.ImageName, scan.ImageTag, job.EnvVars, job.Platform, cacheDir)
	if sbomErr != nil {
		if ctx.Err() == nil {
			log.Warnf("Worker: SBOM scan failed for %s (non-fatal): %v", scanID, sbomErr)
		}
	} else if sbomOut != nil {
		components := ParseSBOMComponents(sbomOut, scanID)
		if len(components) > 0 {
			for i := range components {
				components[i].ScanID = scanID
			}
			if _, err := db.NewInsert().Model(&components).Exec(context.Background()); err != nil {
				log.Warnf("Worker: failed to store SBOM components for %s: %v", scanID, err)
			}
			recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Stored %d SBOM components.", len(components)))
			osvVulns = AugmentJavaVulnerabilitiesFromOSV(ctx, db, scanID, components, vulns)
			if len(osvVulns) > 0 {
				if _, err := db.NewInsert().Model(&osvVulns).Exec(context.Background()); err != nil {
					log.Warnf("Worker: failed to store OSV augmented findings for %s: %v", scanID, err)
					osvVulns = nil
				} else {
					log.Infof("Worker: added %d OSV Java findings for scan %s", len(osvVulns), scanID)
					recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("OSV added %d supplemental Java findings.", len(osvVulns)))
				}
			}
		} else {
			recordScanStepOutput(ctx, db, scanID, "SBOM scan completed without component records.")
		}
	}

	severityCounts := CountSeverities(append(vulns, osvVulns...))

	// If context was cancelled during SBOM, don't mark as completed
	if ctx.Err() != nil {
		return
	}

	// Mark as completed
	completedAt := time.Now()
	scan.Status = models.ScanStatusCompleted
	scan.CompletedAt = &completedAt
	scan.CurrentStep = models.ScanStepCompleted
	if runtimeInfo != nil && runtimeInfo.Version != "" {
		scan.TrivyVersion = runtimeInfo.Version
	} else {
		scan.TrivyVersion = trivyVersion
	}
	scan.GrypeVersion = grypeVersion
	if runtimeInfo != nil {
		scan.TrivyVulnDBUpdatedAt = runtimeInfo.VulnerabilityDB.UpdatedAt
		scan.TrivyVulnDBDownloadedAt = runtimeInfo.VulnerabilityDB.DownloadedAt
		scan.TrivyJavaDBUpdatedAt = runtimeInfo.JavaDB.UpdatedAt
		scan.TrivyJavaDBDownloadedAt = runtimeInfo.JavaDB.DownloadedAt
	}
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
		Column("status", "completed_at", "trivy_version", "grype_version", "image_digest",
			"trivy_vuln_db_updated_at", "trivy_vuln_db_downloaded_at",
			"trivy_java_db_updated_at", "trivy_java_db_downloaded_at",
			"critical_count", "high_count", "medium_count", "low_count", "unknown_count",
			"architecture", "os_family", "os_name").
		Where("id = ?", scanID).Exec(context.Background()); err != nil {
		log.Errorf("Worker: failed to mark scan %s as completed: %v", scanID, err)
		return
	}
	if err := setScanStep(context.Background(), db, scan, models.ScanStepCompleted); err != nil {
		log.Errorf("Worker: failed to record completed step for scan %s: %v", scanID, err)
		return
	}
	recordScanStepOutput(context.Background(), db, scanID, fmt.Sprintf("Scan completed with %d total findings.", len(vulns)+len(osvVulns)))

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

func setFailed(db *bun.DB, scan *models.Scan, msg string) {
	ctx := context.Background()
	log.Errorf("Worker: scan %s failed: %s", scan.ID, msg)
	scan.Status = models.ScanStatusFailed
	scan.CurrentStep = models.ScanStepFailed
	scan.ErrorMessage = msg
	completedAt := time.Now()
	scan.CompletedAt = &completedAt
	columns := []string{"status", "error_message", "completed_at"}
	if scan.ScanProvider == models.ScanProviderArtifactoryXray {
		if !preserveXrayExternalStatusOnFailure(scan.ExternalStatus) {
			scan.ExternalStatus = models.ScanStatusFailed
		}
		columns = append(columns, "external_status")
	}
	db.NewUpdate().Model(scan).
		Column(columns...).
		Where("id = ?", scan.ID).Exec(ctx) //nolint:errcheck
	if err := setScanStep(ctx, db, scan, models.ScanStepFailed); err != nil {
		log.Warnf("Worker: failed to persist failed step for scan %s: %v", scan.ID, err)
	}
	recordScanStepOutput(ctx, db, scan.ID, msg)

	go notifications.Dispatch(db, models.NotificationEventScanFailed, notifications.Payload{
		ScanID:    scan.ID.String(),
		ImageName: scan.ImageName,
		ImageTag:  scan.ImageTag,
		Status:    models.ScanStatusFailed,
		Details:   msg,
	})
}

func preserveXrayExternalStatusOnFailure(status string) bool {
	switch status {
	case models.ScanStatusCancelled, models.ScanExternalStatusBlockedByXrayPolicy:
		return true
	default:
		return false
	}
}

// backfillKB populates vuln_kb from the existing vulnerabilities table for any
// vuln_id not yet present. Runs once at startup so historical scan data appears
// in the KB without requiring a re-scan.
func backfillKB(db *bun.DB) {
	ctx := context.Background()

	// Count how many entries are missing from vuln_kb
	var missing int
	row := db.QueryRowContext(ctx,
		`SELECT COUNT(DISTINCT vuln_id) FROM vulnerabilities v
		 WHERE NOT EXISTS (SELECT 1 FROM vuln_kb k WHERE k.vuln_id = v.vuln_id)`)
	if err := row.Scan(&missing); err != nil || missing == 0 {
		return
	}
	log.Infof("KB backfill: found %d vuln_ids not in vuln_kb, backfilling…", missing)

	// Fetch one representative row per vuln_id (best cvss_score wins).
	// References are intentionally excluded here — they are JSONB and cannot be
	// scanned into []string on a plain struct. New scans populate references via
	// ExtractKBEntries. Backfilled entries have empty references.
	type vulnRow struct {
		VulnID      string  `bun:"vuln_id"`
		Description string  `bun:"description"`
		Severity    string  `bun:"severity"`
		CVSSScore   float64 `bun:"cvss_score"`
		CVSSVector  string  `bun:"cvss_vector"`
	}
	var vulns []vulnRow
	if err := db.NewSelect().
		TableExpr("vulnerabilities").
		ColumnExpr("DISTINCT ON (vuln_id) vuln_id, description, severity, cvss_score, cvss_vector").
		OrderExpr("vuln_id, cvss_score DESC").
		Where("vuln_id NOT IN (SELECT vuln_id FROM vuln_kb)").
		Scan(ctx, &vulns); err != nil {
		log.Warnf("KB backfill: failed to query vulnerabilities: %v", err)
		return
	}

	entries := make([]models.VulnKBEntry, 0, len(vulns))
	for _, v := range vulns {
		entries = append(entries, models.VulnKBEntry{
			VulnID:      v.VulnID,
			Description: v.Description,
			Severity:    v.Severity,
			CVSSScore:   v.CVSSScore,
			CVSSVector:  v.CVSSVector,
			References:  []models.KBRef{},
		})
	}

	if len(entries) == 0 {
		return
	}

	// Batch insert in chunks of 500 to avoid huge single queries
	const chunkSize = 500
	inserted := 0
	for i := 0; i < len(entries); i += chunkSize {
		end := i + chunkSize
		if end > len(entries) {
			end = len(entries)
		}
		chunk := entries[i:end]
		if _, err := db.NewInsert().Model(&chunk).
			On("CONFLICT (vuln_id) DO NOTHING").
			Exec(ctx); err != nil {
			log.Warnf("KB backfill: chunk insert error: %v", err)
			continue
		}
		inserted += len(chunk)
	}
	log.Infof("KB backfill: inserted %d entries into vuln_kb", inserted)
}
