package scanner

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"justscan-backend/compliance"
	effectivesuppressions "justscan-backend/functions/suppressions"
	"justscan-backend/notifications"
	"justscan-backend/pipelines"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// ScanJob represents a queued scan job
type ScanJob struct {
	ScanID      uuid.UUID
	DB          *bun.DB
	EnvVars     []string // optional registry credentials
	Platform    string   // optional platform override (e.g. linux/arm64)
	ArchivePath string   // optional local OCI/Docker archive path for uploaded archive scans
}

var jobQueue chan ScanJob

var (
	activeWorkers  atomic.Int64
	workerPoolSize atomic.Int64
	completedJobs  atomic.Uint64
	queuedScanIDs  sync.Map
)

var (
	ErrScanQueueUnavailable = errors.New("scanner queue is not initialized")
	ErrScanQueueFull        = errors.New("scanner queue is full")
)

// QueueStats is a lightweight operational view of the in-process worker pool.
// Queue depth is intentionally paired with the durable workspace-scoped counts
// in the queue summary handler; it is not used for authorization decisions.
type QueueStats struct {
	Depth             int
	Capacity          int
	ActiveWorkers     int
	WorkerUtilization float64
	CompletedJobs     uint64
}

func GetQueueStats() QueueStats {
	capacity := 0
	depth := 0
	if jobQueue != nil {
		capacity = cap(jobQueue)
		depth = len(jobQueue)
	}
	active := int(activeWorkers.Load())
	utilization := 0.0
	if capacity > 0 {
		poolSize := int(workerPoolSize.Load())
		if poolSize <= 0 {
			poolSize = WorkerConcurrency()
		}
		utilization = float64(active) / float64(poolSize)
		if utilization > 1 {
			utilization = 1
		}
	}
	return QueueStats{
		Depth:             depth,
		Capacity:          capacity,
		ActiveWorkers:     active,
		WorkerUtilization: utilization,
		CompletedJobs:     completedJobs.Load(),
	}
}

// WorkerConcurrency returns the instance-wide number of shared scan workers.
func WorkerConcurrency() int {
	return effectiveScannerSettings().Concurrency
}

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
	concurrency := WorkerConcurrency()
	startScanBackgroundJobReconciler(db)

	jobQueue = make(chan ScanJob, 64)
	workerPoolSize.Store(int64(concurrency))

	for i := 0; i < concurrency; i++ {
		cacheDir := workerCacheDir(i)
		if TrivyEnabled() {
			if err := os.MkdirAll(cacheDir, 0o755); err != nil {
				log.Warnf("Scanner worker %d cache init failed: %v", i, err)
			}
		}
		if GrypeEnabled() {
			if err := os.MkdirAll(workerGrypeCacheDir(cacheDir), 0o755); err != nil {
				log.Warnf("Scanner worker %d grype cache init failed: %v", i, err)
			}
		}
		if TrivyEnabled() {
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
		}
		go workerLoop(i)
	}

	// Workers are ready before recovery starts so a large durable backlog is
	// drained continuously instead of filling the bounded channel once and
	// leaving later rows stranded.
	if requeued, recovered, err := recoverScansAfterRestart(context.Background(), db, time.Now()); err != nil {
		log.Warnf("Scanner startup recovery failed: %v", err)
	} else {
		if requeued > 0 {
			log.Infof("Scanner startup requeued %d pending scans", requeued)
		}
		if recovered > 0 {
			log.Warnf("Scanner startup marked %d interrupted scans as failed", recovered)
		}
	}
	startPendingScanRecovery(db)

	log.Infof("Scanner worker pool started with concurrency=%d", concurrency)
	startScanStaleWatchdog(db)
	StartCVEHistorySync(db)

	// Periodically refresh trivy databases for all workers so they stay current
	// even when no scans are running (e.g. after a startup where the initial
	// warmup failed due to the network not being ready yet).
	if TrivyEnabled() {
		go func() {
			refreshInterval := time.Duration(effectiveScannerSettings().DBMaxAgeHours) * time.Hour
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
	}

	// Backfill the KB before capturing historical intelligence so existing
	// exploit signals are available to the first evidence snapshot. Both jobs
	// are idempotent and safe to retry on the next startup.
	go func() {
		backfillKB(db)
		BackfillVulnerabilityIntelligence(db)
	}()
}

// EnqueueScan queues a scan job. The scan row must already exist in the DB with status=pending.
func EnqueueScan(scanID uuid.UUID, db *bun.DB, envVars []string, platform, archivePath string) error {
	return EnqueueScanContext(context.Background(), scanID, db, envVars, platform, archivePath)
}

// EnqueueScanContext performs a bounded, non-blocking queue send. Callers can
// turn ErrScanQueueFull into a deferred response (or an HTTP 503) instead of
// tying up a request goroutine while the scanner is saturated. The scan row
// remains pending for the recovery dispatcher.
func EnqueueScanContext(ctx context.Context, scanID uuid.UUID, db *bun.DB, envVars []string, platform, archivePath string) error {
	if db == nil || jobQueue == nil {
		return ErrScanQueueUnavailable
	}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	if _, loaded := queuedScanIDs.LoadOrStore(scanID, struct{}{}); loaded {
		// Queueing is idempotent: a retry of the same dispatch request must not
		// turn the already-owned scan into a failure in its caller.
		return nil
	}
	reserved := true
	defer func() {
		if reserved {
			queuedScanIDs.Delete(scanID)
		}
	}()
	if err := setScanStepByID(ctx, db, scanID, models.ScanStepQueued); err != nil {
		return err
	}
	recordScanStepOutput(ctx, db, scanID, "Scan accepted and queued for execution.")
	select {
	case <-ctx.Done():
		return ctx.Err()
	case jobQueue <- ScanJob{ScanID: scanID, DB: db, EnvVars: envVars, Platform: platform, ArchivePath: archivePath}:
		reserved = false
		return nil
	default:
		return ErrScanQueueFull
	}
}

func workerLoop(id int) {
	log.Infof("Scanner worker %d ready", id)
	cacheDir := workerCacheDir(id)
	for job := range jobQueue {
		queuedScanIDs.Delete(job.ScanID)
		activeWorkers.Add(1)
		processScan(job, cacheDir)
		activeWorkers.Add(-1)
		completedJobs.Add(1)
	}
}

// startPendingScanRecovery retries durable pending rows left behind when the
// initial bounded queue was full. The in-memory set prevents duplicate queue
// entries within this process; claimScanForWorker remains the cross-instance
// guard when two processes recover the same durable row.
func startPendingScanRecovery(db *bun.DB) {
	if db == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			recoverPendingScanBatch(db)
		}
	}()
}

func recoverPendingScanBatch(db *bun.DB) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var scans []models.Scan
	if err := db.NewSelect().Model(&scans).
		Where("status = ?", models.ScanStatusPending).
		OrderExpr("created_at ASC").
		Limit(64).
		Scan(ctx); err != nil {
		log.Warnf("Scanner pending recovery query failed: %v", err)
		return
	}
	for i := range scans {
		scan := &scans[i]
		if _, queued := queuedScanIDs.Load(scan.ID); queued {
			continue
		}
		var envVars []string
		if scan.ScanProvider == models.ScanProviderTrivy || scan.ScanProvider == "" {
			_, resolvedEnvVars, resolveErr := ResolveRegistryForScan(ctx, db, scan.ImageName, scan.RegistryID)
			if resolveErr != nil {
				log.Warnf("Scanner pending recovery could not resolve registry for %s: %v", scan.ID, resolveErr)
				continue
			}
			envVars = resolvedEnvVars
		}
		archivePath := ""
		if scan.ScanSource == models.ScanSourceUploadedArchive {
			archivePath = scan.ImageLocation
			if !archiveFileAvailable(archivePath) {
				log.Warnf("Scanner pending recovery is waiting for local archive for %s: %s", scan.ID, archivePath)
				continue
			}
		}
		if err := EnqueueScanContext(ctx, scan.ID, db, envVars, scan.Platform, archivePath); err != nil {
			if !errors.Is(err, ErrScanQueueFull) {
				log.Warnf("Scanner pending recovery could not enqueue %s: %v", scan.ID, err)
			}
			return
		}
	}
}

// recoverScansAfterRestart preserves durable pending work and re-enqueues it,
// while only scans that were actually running are failed as interrupted. This
// avoids turning a full queue or a process restart into silent data loss.
func recoverScansAfterRestart(ctx context.Context, db *bun.DB, now time.Time) (int, int, error) {
	if db == nil {
		return 0, 0, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	// Normalize pending rows left between insert and queue handoff. They remain
	// pending and are then re-enqueued below; terminal rows are not touched.
	if _, err := db.NewUpdate().Model((*models.Scan)(nil)).
		Set("current_step = ?", models.ScanStepQueued).
		Set("last_progress_at = ?", now).
		Where("status = ?", models.ScanStatusPending).
		Exec(ctx); err != nil {
		return 0, 0, fmt.Errorf("normalize pending scans: %w", err)
	}

	var pending []models.Scan
	if err := db.NewSelect().Model(&pending).
		Where("status = ?", models.ScanStatusPending).
		OrderExpr("created_at ASC").
		Scan(ctx); err != nil {
		return 0, 0, fmt.Errorf("load pending scans for recovery: %w", err)
	}
	requeued := 0
	for i := range pending {
		scan := &pending[i]
		var envVars []string
		if scan.ScanProvider == models.ScanProviderTrivy || scan.ScanProvider == "" {
			_, resolvedEnvVars, resolveErr := ResolveRegistryForScan(ctx, db, scan.ImageName, scan.RegistryID)
			if resolveErr != nil {
				log.Warnf("Scanner startup could not resolve registry for %s: %v", scan.ID, resolveErr)
				continue
			}
			envVars = resolvedEnvVars
		}
		archivePath := ""
		if scan.ScanSource == models.ScanSourceUploadedArchive {
			archivePath = scan.ImageLocation
			if !archiveFileAvailable(archivePath) {
				log.Warnf("Scanner startup is waiting for local archive for %s: %s", scan.ID, archivePath)
				continue
			}
		}
		if err := EnqueueScanContext(ctx, scan.ID, db, envVars, scan.Platform, archivePath); err != nil {
			if errors.Is(err, ErrScanQueueFull) {
				log.Warnf("Scanner startup queue full; leaving pending scan %s for a later recovery pass", scan.ID)
				break
			}
			log.Warnf("Scanner startup could not requeue pending scan %s: %v", scan.ID, err)
			continue
		}
		requeued++
	}

	// A process restart must not finalize work that another replica is still
	// executing. Without an owner lease, the only safe recovery signal is a
	// heartbeat that is older than the configured stale window (or is missing).
	// Keep the status predicate in the UPDATE as well because a worker or
	// watchdog may win the race after this SELECT.
	staleTimeout := scanStaleTimeout()
	if staleTimeout <= 0 {
		return requeued, 0, nil
	}
	cutoff := now.Add(-staleTimeout)
	var running []models.Scan
	if err := db.NewSelect().Model(&running).
		Where("status = ?", models.ScanStatusRunning).
		Where("last_progress_at IS NULL OR last_progress_at < ?", cutoff).
		Scan(ctx); err != nil {
		return requeued, 0, fmt.Errorf("load stale running scans for recovery: %w", err)
	}
	recovered := 0
	for i := range running {
		scan := &running[i]
		message := interruptedScanFailureMessage(scan)
		result, err := db.NewUpdate().Model((*models.Scan)(nil)).
			Set("status = ?", models.ScanStatusFailed).
			Set("current_step = ?", models.ScanStepFailed).
			Set("error_message = ?", message).
			Set("completed_at = ?", now).
			Set("last_progress_at = ?", now).
			Where("id = ? AND status = ?", scan.ID, models.ScanStatusRunning).
			Where("last_progress_at IS NULL OR last_progress_at < ?", cutoff).
			Exec(ctx)
		if err != nil {
			return requeued, recovered, fmt.Errorf("mark interrupted scan %s: %w", scan.ID, err)
		}
		rows, rowsErr := result.RowsAffected()
		if rowsErr != nil {
			return requeued, recovered, rowsErr
		}
		if rows == 1 {
			recovered++
		}
	}
	return requeued, recovered, nil
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

	cleanupArchive := false
	cleanupArchivePath := ""
	if scan.ScanSource == models.ScanSourceUploadedArchive {
		if job.ArchivePath == "" {
			job.ArchivePath = scan.ImageLocation
		}
		// Register cleanup before checking cancellation. A queued upload can be
		// cancelled before a worker picks it up and must not strand its archive.
		cleanupArchivePath = job.ArchivePath
		defer func() {
			if cleanupArchive {
				CleanupScanArchive(context.Background(), db, scan.ID, cleanupArchivePath)
			}
		}()
	}

	// Claim atomically. A stale queue entry must never resurrect a cancelled,
	// failed, or completed scan after another request/watchdog has finalized it.
	now := time.Now()
	claimed, err := claimScanForWorker(context.Background(), db, scanID, now)
	if err != nil {
		log.Errorf("Worker: failed to claim scan %s: %v", scanID, err)
		return
	}
	if !claimed {
		log.Infof("Worker: scan %s is no longer pending, skipping", scanID)
		// A duplicate queue entry can observe a scan already running in another
		// worker. It must not remove that worker's archive; a terminal/cancelled
		// row, however, still owns cleanup for this stale queue entry.
		var currentStatus string
		if statusErr := db.NewSelect().Model((*models.Scan)(nil)).Column("status").Where("id = ?", scanID).Scan(context.Background(), &currentStatus); statusErr == nil {
			cleanupArchive = currentStatus != models.ScanStatusRunning
		}
		return
	}
	cleanupArchive = true

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
	// Cancellation can win immediately after the atomic claim but before the
	// in-process cancel function is registered. Re-read the state once so that
	// race cannot start provider work after a committed cancellation.
	var currentStatus string
	if err := db.NewSelect().Model((*models.Scan)(nil)).Column("status").Where("id = ?", scanID).Scan(ctx, &currentStatus); err != nil {
		log.Warnf("Worker: failed to confirm claimed scan %s is still running: %v", scanID, err)
		return
	}
	if currentStatus != models.ScanStatusRunning {
		log.Infof("Worker: scan %s was finalized during claim, skipping", scanID)
		return
	}

	// The database claim above is the state transition; keep the in-memory copy
	// in sync for the provider flow and completion logic.
	scan.Status = models.ScanStatusRunning
	scan.StartedAt = &now
	scan.LastProgressAt = &now

	imageRef := buildImageRef(scan.ImageName, scan.ImageTag)
	log.Infof("Worker: starting scan %s for %s", scanID, imageRef)

	if scan.ScanProvider == models.ScanProviderArtifactoryXray {
		recordScanStepOutput(ctx, db, scanID, "Worker started and handed off to the Xray provider flow.")
		stopHeartbeat := startScanProgressHeartbeat(ctx, db, scanID)
		err := processXrayScan(ctx, db, scan)
		stopHeartbeat()
		if err != nil {
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
	if scan.ScanSource == models.ScanSourceUploadedArchive {
		preparedPath, cleanupPreparedPath, err := prepareUploadedArchiveInput(job.ArchivePath)
		if err != nil {
			setFailed(db, scan, "prepare uploaded archive: "+err.Error())
			return
		}
		job.ArchivePath = preparedPath
		defer cleanupPreparedPath()
	}
	recordScanStepOutput(ctx, db, scanID, "Worker started and is preparing the local scan environment.")
	if job.Platform != "" {
		recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Requested platform override: %s.", job.Platform))
	}

	stopHeartbeat := startScanProgressHeartbeat(ctx, db, scanID)
	runtimeInfo, err := EnsureDatabasesFresh(ctx, cacheDir)
	stopHeartbeat()
	if err != nil {
		setFailed(db, scan, "failed to refresh trivy databases: "+err.Error())
		return
	}
	recordScanStepOutput(ctx, db, scanID, "Scanner databases are ready for this run.")
	if runtimeInfo != nil {
		if runtimeInfo.Version != "" {
			recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Using Trivy %s for this scan.", runtimeInfo.Version))
		}
		if runtimeInfo.VulnerabilityDB.UpdatedAt != nil {
			recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Vulnerability DB updated %s.", runtimeInfo.VulnerabilityDB.UpdatedAt.UTC().Format(time.RFC3339)))
		}
		if runtimeInfo.JavaDB.UpdatedAt != nil {
			recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Java DB updated %s.", runtimeInfo.JavaDB.UpdatedAt.UTC().Format(time.RFC3339)))
		}
	}
	if err := setScanStep(ctx, db, scan, models.ScanStepScanningImage); err != nil {
		setFailed(db, scan, err.Error())
		return
	}
	recordScanStepOutput(ctx, db, scanID, "Starting the image analysis with Trivy.")

	// Run vulnerability scan
	stopHeartbeat = startScanProgressHeartbeat(ctx, db, scanID)
	var trivyOut *TrivyOutput
	var trivyVersion string
	if scan.ScanSource == models.ScanSourceUploadedArchive {
		recordScanStepOutput(ctx, db, scanID, "Scanning uploaded OCI archive input with Trivy.")
		trivyOut, trivyVersion, err = RunScanFromArchive(ctx, job.ArchivePath, job.Platform, cacheDir)
	} else {
		recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Scanning registry image %s with Trivy.", imageRef))
		trivyOut, trivyVersion, err = RunScanWithRegistryRetry(ctx, db, scan, job.EnvVars, job.Platform, cacheDir)
	}
	stopHeartbeat()
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
	recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Trivy returned %d result targets using version %s.", len(trivyOut.Results), trivyVersion))

	// Parse and insert vulnerabilities
	vulns := ParseVulnerabilities(trivyOut, scanID)
	grypeVersion := ""
	kbEntries := ExtractKBEntries(trivyOut)
	recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Parsed %d vulnerability findings and %d knowledge-base entries from Trivy.", len(vulns), len(kbEntries)))
	if GrypeEnabled() {
		recordScanStepOutput(ctx, db, scanID, "Starting secondary Grype analysis to catch findings Trivy may not report.")
		stopHeartbeat = startScanProgressHeartbeat(ctx, db, scanID)
		var grypeOut *GrypeOutput
		var version string
		var grypeErr error
		if scan.ScanSource == models.ScanSourceUploadedArchive {
			recordScanStepOutput(ctx, db, scanID, "Scanning uploaded OCI archive input with Grype.")
			grypeOut, version, grypeErr = RunGrypeScanFromArchive(ctx, job.ArchivePath, job.Platform, cacheDir)
		} else {
			recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Scanning registry image %s with Grype.", imageRef))
			grypeOut, version, grypeErr = RunGrypeScan(ctx, scan.ImageName, scan.ImageTag, job.EnvVars, job.Platform, cacheDir)
		}
		stopHeartbeat()
		if grypeErr != nil {
			if ctx.Err() == nil {
				log.Warnf("Worker: Grype scan failed for %s (non-fatal): %v", scanID, grypeErr)
				recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Grype analysis failed but the scan can continue with Trivy results: %v", grypeErr))
			}
		} else if grypeOut != nil {
			grypeVersion = version
			recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Grype completed using version %s.", version))
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

	// Persist KB entries before the worker finishes so new scan data is available
	// immediately and does not depend on a later startup backfill.
	if len(kbEntries) > 0 {
		recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Upserting %d vulnerability knowledge-base entries.", len(kbEntries)))
		if err := upsertKBEntries(context.Background(), db, kbEntries); err != nil {
			log.Warnf("Worker: KB upsert failed for scan %s (non-fatal): %v", scanID, err)
			recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Knowledge-base upsert failed but the scan can continue: %v", err))
		} else {
			log.Debugf("Worker: upserted %d KB entries for scan %s", len(kbEntries), scanID)
			recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Knowledge-base entries updated for %d vulnerabilities.", len(kbEntries)))
		}
	} else {
		recordScanStepOutput(ctx, db, scanID, "No vulnerability knowledge-base entries were produced for this scan.")
	}

	var osvVulns []models.Vulnerability
	if err := setScanStep(ctx, db, scan, models.ScanStepFinalizingReport); err != nil {
		setFailed(db, scan, err.Error())
		return
	}
	recordScanStepOutput(ctx, db, scanID, "Finalizing the report and running post-processing steps.")
	recordScanStepOutput(ctx, db, scanID, "Collecting SBOM components and applying Java OSV enrichment where applicable.")

	// Run SBOM scan (best-effort, don't fail the whole scan if it errors)
	stopHeartbeat = startScanProgressHeartbeat(ctx, db, scanID)
	var sbomOut *TrivySBOMOutput
	var sbomErr error
	if scan.ScanSource == models.ScanSourceUploadedArchive {
		recordScanStepOutput(ctx, db, scanID, "Collecting SBOM components from the uploaded OCI archive.")
		sbomOut, sbomErr = RunSBOMScanFromArchive(ctx, job.ArchivePath, job.Platform, cacheDir)
	} else {
		recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Collecting SBOM components from %s.", imageRef))
		sbomOut, sbomErr = RunSBOMScan(ctx, scan.ImageName, scan.ImageTag, job.EnvVars, job.Platform, cacheDir)
	}
	stopHeartbeat()
	if sbomErr != nil {
		if ctx.Err() == nil {
			log.Warnf("Worker: SBOM scan failed for %s (non-fatal): %v", scanID, sbomErr)
			recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("SBOM collection failed but vulnerability results are still available: %v", sbomErr))
		}
	} else if sbomOut != nil {
		components := ParseSBOMComponents(sbomOut, scanID)
		if len(components) > 0 {
			if err := PersistSBOMDocument(context.Background(), db, scanID, sbomOut, SBOMSourceTrivy, ""); err != nil {
				log.Warnf("Worker: failed to store SBOM document for %s: %v", scanID, err)
				recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("SBOM document storage failed: %v", err))
			} else if err := LinkVulnerabilitiesToSBOM(context.Background(), db, scanID); err != nil {
				log.Warnf("Worker: failed to link vulnerabilities to SBOM for %s: %v", scanID, err)
			} else {
				recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Stored %d SBOM components and their dependency graph.", len(components)))
			}
			osvVulns = AugmentJavaVulnerabilitiesFromOSV(ctx, db, scanID, components, vulns)
			if len(osvVulns) > 0 {
				if _, err := db.NewInsert().Model(&osvVulns).Exec(context.Background()); err != nil {
					log.Warnf("Worker: failed to store OSV augmented findings for %s: %v", scanID, err)
					recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("OSV enrichment found supplemental Java findings, but storing them failed: %v", err))
					osvVulns = nil
				} else {
					log.Infof("Worker: added %d OSV Java findings for scan %s", len(osvVulns), scanID)
					recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("OSV added %d supplemental Java findings.", len(osvVulns)))
					if err := LinkVulnerabilitiesToSBOM(context.Background(), db, scanID); err != nil {
						log.Warnf("Worker: failed to link OSV findings to SBOM for %s: %v", scanID, err)
					}
				}
			} else {
				recordScanStepOutput(ctx, db, scanID, "OSV enrichment did not add supplemental Java findings.")
			}
		} else {
			recordScanStepOutput(ctx, db, scanID, "SBOM scan completed without component records.")
		}
	}

	severityCounts := CountSeverities(append(vulns, osvVulns...))
	recordScanStepOutput(ctx, db, scanID, fmt.Sprintf("Severity counts calculated: %d critical, %d high, %d medium, %d low, %d unknown.", severityCounts[models.SeverityCritical], severityCounts[models.SeverityHigh], severityCounts[models.SeverityMedium], severityCounts[models.SeverityLow], severityCounts[models.SeverityUnknown]))

	// If context was cancelled during SBOM, don't mark as completed
	if ctx.Err() != nil {
		return
	}

	// Mark as completed
	completedAt := time.Now()
	scan.Status = models.ScanStatusCompleted
	scan.CompletedAt = &completedAt
	scan.LastProgressAt = &completedAt
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
	if suppressedCount, err := effectivesuppressions.RecalculateSuppressedCount(context.Background(), db, scan); err != nil {
		log.Warnf("Worker: failed to recalculate suppressed count for scan %s (non-fatal): %v", scanID, err)
		recordScanStepOutput(context.Background(), db, scanID, fmt.Sprintf("Suppression count recalculation failed but the report can still be saved: %v", err))
	} else {
		scan.SuppressedCount = suppressedCount
		recordScanStepOutput(context.Background(), db, scanID, fmt.Sprintf("Suppression count recalculated: %d findings suppressed.", suppressedCount))
	}

	result, err := db.NewUpdate().Model(scan).
		Column("status", "current_step", "last_progress_at", "completed_at", "trivy_version", "grype_version", "image_digest",
			"trivy_vuln_db_updated_at", "trivy_vuln_db_downloaded_at",
			"trivy_java_db_updated_at", "trivy_java_db_downloaded_at",
			"critical_count", "high_count", "medium_count", "low_count", "unknown_count", "suppressed_count",
			"architecture", "os_family", "os_name").
		Where("id = ? AND status = ?", scanID, models.ScanStatusRunning).Exec(context.Background())
	if err != nil {
		log.Errorf("Worker: failed to mark scan %s as completed: %v", scanID, err)
		return
	}
	rows, rowsErr := result.RowsAffected()
	if rowsErr != nil {
		log.Errorf("Worker: failed to confirm terminal transition for scan %s: %v", scanID, rowsErr)
		return
	}
	if rows == 0 {
		// Cancellation or the stale watchdog won the terminal-state race.
		log.Infof("Worker: scan %s was finalized before completion could be persisted", scanID)
		return
	}
	if err := appendTerminalScanStepLog(context.Background(), db, scanID, models.ScanStepCompleted); err != nil {
		log.Errorf("Worker: failed to record completed step for scan %s: %v", scanID, err)
		return
	}
	if err := RecordIntelligenceSnapshot(context.Background(), db, scan); err != nil {
		log.Warnf("Worker: intelligence snapshot failed for scan %s (non-fatal): %v", scanID, err)
		recordScanStepOutput(context.Background(), db, scanID, fmt.Sprintf("Scan-time intelligence snapshot failed, but the scan result remains available: %v", err))
	} else {
		recordScanStepOutput(context.Background(), db, scanID, "Stored scan-time vulnerability intelligence and refreshed current posture.")
	}
	recordScanStepOutput(context.Background(), db, scanID, fmt.Sprintf("Scan completed with %d total findings.", len(vulns)+len(osvVulns)))
	recordScanStepOutput(context.Background(), db, scanID, "Queued compliance evaluation, auto-tagging, and completion notifications.")

	log.Infof("Worker: scan %s completed — CRIT:%d HIGH:%d MED:%d LOW:%d UNK:%d",
		scanID,
		scan.CriticalCount, scan.HighCount, scan.MediumCount, scan.LowCount, scan.UnknownCount)

	// Evaluate compliance for explicit organization grants only.
	go compliance.RunForScan(db, scanID)

	// Apply auto-tag rules based on image name/tag patterns
	go applyAutoTags(db, scan)

	// Fire completion notification
	notifications.Dispatch(db, models.NotificationEventScanComplete, notifications.Payload{
		ScanID:    scanID.String(),
		ImageName: scan.ImageName,
		ImageTag:  scan.ImageTag,
		Status:    models.ScanStatusCompleted,
		Details: fmt.Sprintf("Critical: %d  High: %d  Medium: %d  Low: %d",
			scan.CriticalCount, scan.HighCount, scan.MediumCount, scan.LowCount),
	})
	if err := pipelines.QueueCallbackForScan(context.Background(), db, scanID.String()); err != nil && err != sql.ErrNoRows {
		log.Warnf("Worker: failed to queue pipeline callback for completed scan %s: %v", scanID, err)
	}
}

func applyAutoTags(db *bun.DB, scan *models.Scan) {
	ctx := context.Background()
	var rules []models.AutoTagRule
	if err := db.NewSelect().Model(&rules).Scan(ctx); err != nil {
		return
	}

	imageFull := buildImageRef(scan.ImageName, scan.ImageTag)

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
	if !persistFailedScan(ctx, db, scan, msg, nil) {
		return
	}
	finishFailedScan(ctx, db, scan, msg)
}

// persistFailedScan applies a conditional terminal transition. staleBefore,
// when provided, makes the watchdog re-check last_progress_at in the same SQL
// statement so a heartbeat committed after its initial SELECT wins the race.
func persistFailedScan(ctx context.Context, db *bun.DB, scan *models.Scan, msg string, staleBefore *time.Time) bool {
	if db == nil || scan == nil {
		return false
	}
	scan.Status = models.ScanStatusFailed
	scan.CurrentStep = models.ScanStepFailed
	scan.ErrorMessage = msg
	completedAt := time.Now()
	scan.CompletedAt = &completedAt
	scan.LastProgressAt = &completedAt
	columns := []string{"status", "current_step", "last_progress_at", "error_message", "completed_at", "critical_count", "high_count", "medium_count", "low_count", "unknown_count", "suppressed_count"}
	if scan.ScanProvider == models.ScanProviderArtifactoryXray {
		if !preserveXrayExternalStatusOnFailure(scan.ExternalStatus) {
			scan.ExternalStatus = models.ScanStatusFailed
		}
		columns = append(columns, "external_status")
	}
	query := db.NewUpdate().Model(scan).
		Column(columns...).
		Where("id = ? AND status IN (?)", scan.ID, bun.In([]string{models.ScanStatusPending, models.ScanStatusRunning}))
	if staleBefore != nil {
		query = query.Where("last_progress_at IS NULL OR last_progress_at < ?", *staleBefore)
	}
	result, err := query.Exec(ctx)
	if err != nil {
		log.Warnf("Worker: failed to persist failure for scan %s: %v", scan.ID, err)
		return false
	}
	rows, rowsErr := result.RowsAffected()
	if rowsErr != nil {
		log.Warnf("Worker: failed to confirm failure transition for scan %s: %v", scan.ID, rowsErr)
		return false
	}
	if rows == 0 {
		// A terminal writer (usually cancellation) won the race. Do not append
		// a failed step or emit a duplicate failure notification/callback.
		log.Infof("Worker: scan %s was already terminal; failure result discarded", scan.ID)
		return false
	}
	return true
}

func finishFailedScan(ctx context.Context, db *bun.DB, scan *models.Scan, msg string) {
	if err := appendTerminalScanStepLog(ctx, db, scan.ID, models.ScanStepFailed); err != nil {
		log.Warnf("Worker: failed to persist failed step for scan %s: %v", scan.ID, err)
	}
	recordScanStepOutput(ctx, db, scan.ID, msg)

	notifications.Dispatch(db, models.NotificationEventScanFailed, notifications.Payload{
		ScanID:    scan.ID.String(),
		ImageName: scan.ImageName,
		ImageTag:  scan.ImageTag,
		Status:    models.ScanStatusFailed,
		Details:   msg,
	})
	if err := pipelines.QueueCallbackForScan(ctx, db, scan.ID.String()); err != nil && err != sql.ErrNoRows {
		log.Warnf("Worker: failed to queue pipeline callback for failed scan %s: %v", scan.ID, err)
	}
}

func preserveXrayExternalStatusOnFailure(status string) bool {
	switch status {
	case models.ScanStatusCancelled, models.ScanExternalStatusBlockedByXrayPolicy:
		return true
	default:
		return false
	}
}

// CleanupScanArchive removes an uploaded archive only after proving ownership
// of its immediate upload directory. One-shot uploads use scanID as the
// directory ID; resumable uploads use archive_upload_sessions.scan_id to bind
// the session directory to this scan. A UUID-shaped path by itself is not
// sufficient because a corrupted scan row could otherwise delete another
// user's upload directory.
func CleanupScanArchive(ctx context.Context, db *bun.DB, scanID uuid.UUID, archivePath string) {
	trimmed := strings.TrimSpace(archivePath)
	if trimmed == "" || scanID == uuid.Nil {
		return
	}
	root, uploadID, ok := validatedUploadDirectoryWithID(trimmed)
	if !ok {
		log.Warnf("Worker: refusing to remove archive outside a validated upload directory for scan %s: %s", scanID, trimmed)
		return
	}
	if uploadID != scanID {
		if db == nil || ctx == nil {
			log.Warnf("Worker: refusing to remove resumable archive without ownership lookup for scan %s: %s", scanID, trimmed)
			return
		}
		var session struct {
			ID          uuid.UUID  `bun:"id"`
			ScanID      *uuid.UUID `bun:"scan_id"`
			ArchivePath string     `bun:"archive_path"`
		}
		err := db.NewSelect().TableExpr("archive_upload_sessions").
			Column("id", "scan_id", "archive_path").
			Where("id = ? AND scan_id = ? AND archive_path = ?", uploadID, scanID, filepath.Clean(trimmed)).
			Scan(ctx, &session)
		if err != nil {
			log.Warnf("Worker: refusing to remove archive without matching upload session for scan %s at %s: %v", scanID, trimmed, err)
			return
		}
	}
	if err := os.RemoveAll(root); err != nil {
		log.Warnf("Worker: failed to remove uploaded archive directory for scan %s at %s: %v", scanID, root, err)
	} else {
		log.Infof("Worker: removed uploaded archive directory for scan %s at %s", scanID, root)
		if uploadID != scanID && db != nil {
			if _, err := db.NewDelete().TableExpr("archive_upload_sessions").
				Where("id = ? AND scan_id = ? AND archive_path = ?", uploadID, scanID, filepath.Clean(trimmed)).
				Exec(ctx); err != nil {
				log.Warnf("Worker: failed to remove archive upload session for scan %s: %v", scanID, err)
			}
		}
	}
}

// cleanupScanArchive is retained for package-local callers/tests and is
// intentionally strict: without the session table it can only remove a
// one-shot directory whose UUID is exactly the scan ID.
func cleanupScanArchive(scanID uuid.UUID, archivePath string) {
	CleanupScanArchive(context.Background(), nil, scanID, archivePath)
}

func validatedUploadDirectoryWithID(archivePath string) (string, uuid.UUID, bool) {
	uploadsRoot := filepath.Join(os.TempDir(), "justscan", "uploads")
	cleanPath := filepath.Clean(strings.TrimSpace(archivePath))
	relativeToUploads, err := filepath.Rel(uploadsRoot, cleanPath)
	if err != nil || relativeToUploads == "." || filepath.IsAbs(relativeToUploads) || relativeToUploads == ".." || strings.HasPrefix(relativeToUploads, ".."+string(filepath.Separator)) {
		return "", uuid.Nil, false
	}
	parts := strings.Split(relativeToUploads, string(filepath.Separator))
	if len(parts) < 2 {
		return "", uuid.Nil, false
	}
	uploadID, err := uuid.Parse(parts[0])
	if err != nil {
		return "", uuid.Nil, false
	}
	return filepath.Join(uploadsRoot, parts[0]), uploadID, true
}

func validatedUploadDirectory(archivePath string) (string, bool) {
	root, _, ok := validatedUploadDirectoryWithID(archivePath)
	return root, ok
}

// archiveFileAvailable shares containment validation with cleanup but is read-only.
func archiveFileAvailable(archivePath string) bool {
	if _, ok := validatedUploadDirectory(archivePath); !ok {
		return false
	}
	info, err := os.Stat(filepath.Clean(archivePath))
	return err == nil && !info.IsDir()
}

// claimScanForWorker performs the only pending -> running transition. Rows
// affected is deliberately checked so a queued duplicate cannot overwrite a
// terminal state that was committed by cancellation or the watchdog.
func claimScanForWorker(ctx context.Context, db *bun.DB, scanID uuid.UUID, startedAt time.Time) (bool, error) {
	if db == nil || scanID == uuid.Nil {
		return false, fmt.Errorf("database and scan ID are required")
	}
	result, err := db.NewUpdate().Model((*models.Scan)(nil)).
		Set("status = ?", models.ScanStatusRunning).
		Set("started_at = ?", startedAt).
		Set("last_progress_at = ?", startedAt).
		Where("id = ? AND status = ?", scanID, models.ScanStatusPending).
		Exec(ctx)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return rows == 1, nil
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
