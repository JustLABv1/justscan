// Package gitrepositories discovers container images declared in HTTPS Git repositories.
package gitrepositories

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"justscan-backend/config"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/crypto"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/google/uuid"
	"github.com/robfig/cron/v3"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
	"sigs.k8s.io/kustomize/api/krusty"
	"sigs.k8s.io/kustomize/api/types"
	"sigs.k8s.io/kustomize/kyaml/filesys"
	"sigs.k8s.io/yaml"
)

const (
	cloneTimeout           = 2 * time.Minute
	maxManifestBytes int64 = 5 * 1024 * 1024
)

var ErrRunNotCancellable = errors.New("repository run is not active")

type ImageLocation struct {
	File      string `json:"file"`
	Target    string `json:"target,omitempty"`
	Document  int    `json:"document"`
	Kind      string `json:"kind,omitempty"`
	Name      string `json:"name,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	Path      string `json:"path"`
}

type DiscoveredImage struct {
	FullRef    string          `json:"full_ref"`
	ImageName  string          `json:"image_name"`
	ImageTag   string          `json:"image_tag"`
	Locations  []ImageLocation `json:"locations"`
	RegistryID *uuid.UUID      `json:"registry_id,omitempty"`
}

type DiscoveryCandidate struct {
	Path         string
	DetectedType string
	Confidence   string
	Evidence     models.JSONObject
	Status       string
	RuleID       *uuid.UUID
}

type repositoryDiscoveryResult struct {
	images   []DiscoveredImage
	warnings []DiscoveryCandidate
}

// justScanConfig is optional repository-owned discovery configuration. It
// composes multiple deployment mechanisms in one dry run.
type justScanConfig struct {
	Version   int `yaml:"version"`
	Discovery struct {
		Sources []justScanSource `yaml:"sources"`
		Rules   []justScanRule   `yaml:"rules"`
	} `yaml:"discovery"`
}

type justScanSource struct {
	Type        string   `yaml:"type"`
	Root        string   `yaml:"root"`
	Paths       []string `yaml:"paths"`
	Chart       string   `yaml:"chart"`
	Values      []string `yaml:"values"`
	ReleaseName string   `yaml:"releaseName"`
}

type justScanRule struct {
	Match       string   `yaml:"match"`
	Type        string   `yaml:"type"`
	Chart       string   `yaml:"chart"`
	Values      []string `yaml:"values"`
	ReleaseName string   `yaml:"releaseName"`
	Paths       []string `yaml:"paths"`
}

var state struct {
	sync.Mutex
	db      *bun.DB
	jobs    chan uuid.UUID
	cron    *cron.Cron
	entries map[uuid.UUID]cron.EntryID
}

func Start(db *bun.DB) {
	state.Lock()
	if state.db != nil {
		state.Unlock()
		return
	}
	state.db, state.jobs, state.cron, state.entries = db, make(chan uuid.UUID, 32), cron.New(), make(map[uuid.UUID]cron.EntryID)
	state.cron.Start()
	state.Unlock()
	go worker()
	go reconcileLoop(db)
	var repositories []models.GitRepository
	if err := db.NewSelect().Model(&repositories).Where("enabled = true").Scan(context.Background()); err != nil {
		log.Warnf("git repositories: load schedules: %v", err)
		return
	}
	for _, repository := range repositories {
		SyncSchedule(repository)
	}
	var runs []models.GitRepositoryRun
	if err := db.NewSelect().Model(&runs).Where("status IN (?)", bun.In([]string{models.GitRepositoryRunQueued, models.GitRepositoryRunDiscovering})).Scan(context.Background()); err == nil {
		for _, run := range runs {
			enqueue(run.ID)
		}
	}
}

func Stop() {
	state.Lock()
	defer state.Unlock()
	if state.cron != nil {
		state.cron.Stop()
	}
	state.db, state.jobs, state.cron, state.entries = nil, nil, nil, nil
}

func SyncSchedule(repository models.GitRepository) {
	state.Lock()
	defer state.Unlock()
	if state.cron == nil {
		return
	}
	if old, ok := state.entries[repository.ID]; ok {
		state.cron.Remove(old)
		delete(state.entries, repository.ID)
	}
	if !repository.Enabled {
		return
	}
	location, err := time.LoadLocation(defaultTimezone(repository.Timezone))
	if err != nil {
		log.Warnf("git repository %s invalid timezone: %v", repository.ID, err)
		return
	}
	spec := strings.TrimSpace(repository.Schedule)
	if _, err := cron.ParseStandard(spec); err != nil {
		log.Warnf("git repository %s invalid schedule: %v", repository.ID, err)
		return
	}
	id, err := state.cron.AddFunc(fmt.Sprintf("CRON_TZ=%s %s", location.String(), spec), func() {
		_, err := CreateRun(context.Background(), repository.ID, "scheduled", "", nil)
		if err != nil {
			log.Warnf("git repository scheduled run %s: %v", repository.ID, err)
		}
	})
	if err == nil {
		state.entries[repository.ID] = id
	}
}

func Unschedule(repositoryID uuid.UUID) { SyncSchedule(models.GitRepository{ID: repositoryID}) }

func CreateRun(ctx context.Context, repositoryID uuid.UUID, trigger, policy string, requestedImages []string) (*models.GitRepositoryRun, error) {
	state.Lock()
	db := state.db
	state.Unlock()
	if db == nil {
		return nil, fmt.Errorf("git repository service is not running")
	}
	var repository models.GitRepository
	if err := db.NewSelect().Model(&repository).Where("id = ?", repositoryID).Scan(ctx); err != nil {
		return nil, fmt.Errorf("repository not found")
	}
	var active bool
	if err := db.NewSelect().Table("git_repository_runs").ColumnExpr("1").Where("repository_id = ?", repositoryID).Where("status IN (?)", bun.In([]string{models.GitRepositoryRunQueued, models.GitRepositoryRunDiscovering, models.GitRepositoryRunScanning})).Scan(ctx, &active); err == nil && active {
		return nil, fmt.Errorf("a repository run is already active")
	}
	if policy == "" {
		policy = repository.RescanPolicy
	}
	if policy != models.GitRepositoryRescanChanged && policy != models.GitRepositoryRescanAll {
		return nil, fmt.Errorf("invalid rescan policy")
	}
	if trigger == "" {
		trigger = "manual"
	}
	requestedImages = uniqueImageRefs(requestedImages)
	run := &models.GitRepositoryRun{RepositoryID: repositoryID, Trigger: trigger, RequestedPolicy: policy, Ref: repository.Ref, RequestedImages: requestedImages, Status: models.GitRepositoryRunQueued, CreatedAt: time.Now()}
	if _, err := db.NewInsert().Model(run).Exec(ctx); err != nil {
		return nil, err
	}
	enqueue(run.ID)
	return run, nil
}

// CancelRun stops a repository run and any pending or running child scans. A
// worker may still finish an in-flight repository clone, but it checks the run
// state before it creates or dispatches more scans.
func CancelRun(ctx context.Context, db *bun.DB, repositoryID, runID uuid.UUID) (*models.GitRepositoryRun, error) {
	var run models.GitRepositoryRun
	if err := db.NewSelect().Model(&run).Where("id = ? AND repository_id = ?", runID, repositoryID).Scan(ctx); err != nil {
		return nil, err
	}
	activeStatuses := []string{models.GitRepositoryRunQueued, models.GitRepositoryRunDiscovering, models.GitRepositoryRunScanning}
	if !containsRunStatus(activeStatuses, run.Status) {
		return nil, ErrRunNotCancellable
	}

	now := time.Now()
	result, err := db.NewUpdate().Model((*models.GitRepositoryRun)(nil)).
		Set("status = ?", models.GitRepositoryRunCancelled).
		Set("error_message = ?", "Cancelled by user").
		Set("completed_at = ?", now).
		Where("id = ?", runID).
		Where("status IN (?)", bun.In(activeStatuses)).
		Exec(ctx)
	if err != nil {
		return nil, err
	}
	if affected, err := result.RowsAffected(); err != nil || affected == 0 {
		return nil, ErrRunNotCancellable
	}

	var scans []models.Scan
	if err := db.NewSelect().Model(&scans).
		Where("git_repository_run_id = ?", runID).
		Where("status IN (?)", bun.In([]string{models.ScanStatusPending, models.ScanStatusRunning})).
		Scan(ctx); err != nil {
		return nil, err
	}
	for _, scan := range scans {
		scanner.CancelScan(scan.ID)
	}
	if _, err := db.NewUpdate().Model((*models.Scan)(nil)).
		Set("status = ?", models.ScanStatusCancelled).
		Set("current_step = ?", models.ScanStepCancelled).
		Set("error_message = ?", "Cancelled with repository run").
		Set("completed_at = ?", now).
		Set("last_progress_at = ?", now).
		Where("git_repository_run_id = ?", runID).
		Where("status IN (?)", bun.In([]string{models.ScanStatusPending, models.ScanStatusRunning})).
		Exec(ctx); err != nil {
		return nil, err
	}
	if _, err := db.NewUpdate().Model((*models.Scan)(nil)).
		Set("external_status = ?", models.ScanStatusCancelled).
		Where("git_repository_run_id = ?", runID).
		Where("scan_provider = ?", models.ScanProviderArtifactoryXray).
		Where("status = ?", models.ScanStatusCancelled).
		Exec(ctx); err != nil {
		return nil, err
	}
	for _, scan := range scans {
		if err := scanner.MarkScanCancelled(ctx, db, scan.ID, "Cancelled with repository run"); err != nil {
			return nil, err
		}
	}
	if _, err := db.NewUpdate().Table("git_repository_run_images").
		Set("state = ?", models.ScanStatusCancelled).
		Where("run_id = ?", runID).
		Where("scan_id IS NULL").
		Where("state IN (?)", bun.In([]string{"discovered", "queued"})).
		Exec(ctx); err != nil {
		return nil, err
	}

	run.Status = models.GitRepositoryRunCancelled
	run.ErrorMessage = "Cancelled by user"
	run.CompletedAt = &now
	return &run, nil
}

func containsRunStatus(statuses []string, status string) bool {
	for _, candidate := range statuses {
		if candidate == status {
			return true
		}
	}
	return false
}

// CreateDiscovery performs a persisted dry run. It clones and inspects the
// repository, but never creates or dispatches image scans.
func CreateDiscovery(ctx context.Context, repositoryID uuid.UUID) (*models.GitRepositoryRun, []DiscoveredImage, error) {
	state.Lock()
	db := state.db
	state.Unlock()
	if db == nil {
		return nil, nil, fmt.Errorf("git repository service is not running")
	}
	var repository models.GitRepository
	if err := db.NewSelect().Model(&repository).Where("id = ?", repositoryID).Scan(ctx); err != nil {
		return nil, nil, fmt.Errorf("repository not found")
	}
	now := time.Now()
	run := &models.GitRepositoryRun{
		RepositoryID:    repository.ID,
		Trigger:         "dry_run",
		RequestedPolicy: repository.RescanPolicy,
		Ref:             repository.Ref,
		Status:          models.GitRepositoryRunDiscovering,
		StartedAt:       &now,
		CreatedAt:       now,
	}
	if _, err := db.NewInsert().Model(run).Exec(ctx); err != nil {
		return nil, nil, err
	}
	images, candidates, commitSHA, err := DiscoverReview(ctx, repository)
	if err != nil {
		failRun(ctx, db, run, err)
		return run, nil, err
	}
	completedAt := time.Now()
	run.CommitSHA = commitSHA
	run.TargetCount = len(uniqueTargetFiles(images))
	run.ImageCount = len(images)
	run.UnresolvedCount = unresolvedCandidates(candidates)
	run.Status = models.GitRepositoryRunCompleted
	run.CompletedAt = &completedAt
	if err := db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		for _, image := range images {
			row := &models.GitRepositoryRunImage{
				RunID: run.ID, FullRef: image.FullRef, ImageName: image.ImageName, ImageTag: image.ImageTag,
				Locations: models.JSONObject{"items": image.Locations}, State: "discovered", RegistryID: image.RegistryID, CreatedAt: completedAt,
			}
			if _, err := tx.NewInsert().Model(row).Exec(ctx); err != nil {
				return err
			}
		}
		for _, candidate := range candidates {
			row := &models.GitRepositoryRunCandidate{RunID: run.ID, Path: candidate.Path, DetectedType: candidate.DetectedType, Confidence: candidate.Confidence, Evidence: candidate.Evidence, Status: candidate.Status, RuleID: candidate.RuleID, CreatedAt: completedAt}
			if _, err := tx.NewInsert().Model(row).Exec(ctx); err != nil {
				return err
			}
		}
		_, err := tx.NewUpdate().Model(run).Column("commit_sha", "target_count", "image_count", "unresolved_count", "status", "completed_at").Where("id = ?", run.ID).Exec(ctx)
		return err
	}); err != nil {
		return nil, nil, err
	}
	return run, images, nil
}

func enqueue(runID uuid.UUID) {
	state.Lock()
	jobs := state.jobs
	state.Unlock()
	if jobs == nil {
		return
	}
	select {
	case jobs <- runID:
	default:
		go func() { jobs <- runID }()
	}
}
func worker() {
	for runID := range state.jobs {
		processRun(runID)
	}
}

func processRun(runID uuid.UUID) {
	state.Lock()
	db := state.db
	state.Unlock()
	if db == nil {
		return
	}
	ctx := context.Background()
	var run models.GitRepositoryRun
	if err := db.NewSelect().Model(&run).Where("id = ?", runID).Scan(ctx); err != nil {
		return
	}
	if run.Status == models.GitRepositoryRunCancelled {
		return
	}
	var repository models.GitRepository
	if err := db.NewSelect().Model(&repository).Where("id = ?", run.RepositoryID).Scan(ctx); err != nil {
		failRun(ctx, db, &run, err)
		return
	}
	now := time.Now()
	result, err := db.NewUpdate().Model((*models.GitRepositoryRun)(nil)).
		Set("status = ?", models.GitRepositoryRunDiscovering).
		Set("started_at = ?", now).
		Where("id = ?", run.ID).
		Where("status IN (?)", bun.In([]string{models.GitRepositoryRunQueued, models.GitRepositoryRunDiscovering})).
		Exec(ctx)
	if err != nil {
		return
	}
	if affected, err := result.RowsAffected(); err != nil || affected == 0 {
		return
	}
	run.Status, run.StartedAt = models.GitRepositoryRunDiscovering, &now
	images, candidates, commitSHA, err := DiscoverReview(ctx, repository)
	if err != nil {
		failRun(ctx, db, &run, err)
		return
	}
	if runCancelled(ctx, db, run.ID) {
		return
	}
	images = requestedDiscoveredImages(images, run.RequestedImages)
	run.CommitSHA, run.TargetCount, run.ImageCount, run.UnresolvedCount = commitSHA, len(uniqueTargetFiles(images)), len(images), unresolvedCandidates(candidates)
	for _, candidate := range candidates {
		if runCancelled(ctx, db, run.ID) {
			return
		}
		row := &models.GitRepositoryRunCandidate{RunID: run.ID, Path: candidate.Path, DetectedType: candidate.DetectedType, Confidence: candidate.Confidence, Evidence: candidate.Evidence, Status: candidate.Status, RuleID: candidate.RuleID, CreatedAt: time.Now()}
		if _, err := db.NewInsert().Model(row).Exec(ctx); err != nil {
			failRun(ctx, db, &run, err)
			return
		}
	}
	registryOverrides := imageRegistryOverrides(ctx, db, repository.ID)
	currentRegistryIDs := make(map[string]*uuid.UUID, len(images))
	for _, image := range images {
		registryID := image.RegistryID
		if override, ok := registryOverrides[image.FullRef]; ok {
			registryID = &override
		}
		currentRegistryIDs[image.FullRef] = registryID
	}
	previous := previousRefs(ctx, db, repository.ID, run.ID, registryOverrides, currentRegistryIDs)
	excluded := excludedImageRefs(ctx, db, repository.ID)
	created := 0
	for _, image := range images {
		if runCancelled(ctx, db, run.ID) {
			return
		}
		registryID := image.RegistryID
		if override, ok := registryOverrides[image.FullRef]; ok {
			registryID = &override
		}
		stateName := "discovered"
		if excluded[image.FullRef] {
			row := &models.GitRepositoryRunImage{RunID: run.ID, FullRef: image.FullRef, ImageName: image.ImageName, ImageTag: image.ImageTag, Locations: models.JSONObject{"items": image.Locations}, State: "excluded", RegistryID: registryID, CreatedAt: time.Now()}
			db.NewInsert().Model(row).Exec(ctx) //nolint:errcheck
			continue
		}
		if run.RequestedPolicy == models.GitRepositoryRescanChanged && previous[image.FullRef] {
			stateName = "unchanged"
		}
		row := &models.GitRepositoryRunImage{RunID: run.ID, FullRef: image.FullRef, ImageName: image.ImageName, ImageTag: image.ImageTag, Locations: models.JSONObject{"items": image.Locations}, State: stateName, RegistryID: registryID, CreatedAt: time.Now()}
		if stateName == "unchanged" {
			db.NewInsert().Model(row).Exec(ctx)
			continue
		}
		scan, envVars, err := createScan(ctx, db, repository, run.ID, image, registryID)
		if err != nil {
			row.State = "failed"
			row.Locations["error"] = err.Error()
			db.NewInsert().Model(row).Exec(ctx)
			continue
		}
		row.ScanID, row.State = &scan.ID, "queued"
		if err := db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.NewInsert().Model(scan).Exec(ctx); err != nil {
				return err
			}
			if repository.OwnerOrgID != nil {
				if _, err := tx.NewInsert().Model(&models.OrgScan{OrgID: *repository.OwnerOrgID, ScanID: scan.ID}).On("CONFLICT DO NOTHING").Exec(ctx); err != nil {
					return err
				}
			}
			if _, err := tx.NewInsert().Model(row).Exec(ctx); err != nil {
				return err
			}
			return attachScanTags(ctx, tx, scan.ID, repository.TagIDs)
		}); err != nil {
			continue
		}
		if runCancelled(ctx, db, run.ID) {
			cancelRepositoryRunScan(ctx, db, scan.ID)
			return
		}
		created++
		if err := scanner.DispatchScan(ctx, db, scan, envVars, ""); err != nil {
			if runCancelled(ctx, db, run.ID) {
				cancelRepositoryRunScan(ctx, db, scan.ID)
			} else {
				scanner.MarkScanFailed(ctx, db, scan.ID, err.Error())
			}
		} //nolint:errcheck
	}
	if runCancelled(ctx, db, run.ID) {
		return
	}
	run.ScanCount, run.Status = created, models.GitRepositoryRunScanning
	db.NewUpdate().Model(&run).Column("commit_sha", "target_count", "image_count", "unresolved_count", "scan_count", "status").Where("id = ?", run.ID).Exec(ctx) //nolint:errcheck
	db.NewUpdate().Model(&repository).Set("last_run_id = ?", run.ID).Set("last_run_at = ?", time.Now()).Where("id = ?", repository.ID).Exec(ctx)                 //nolint:errcheck
	if created == 0 {
		reconcileRun(ctx, db, run.ID)
	}
}

func runCancelled(ctx context.Context, db *bun.DB, runID uuid.UUID) bool {
	var status string
	if err := db.NewSelect().Model((*models.GitRepositoryRun)(nil)).Column("status").Where("id = ?", runID).Scan(ctx, &status); err != nil {
		return false
	}
	return status == models.GitRepositoryRunCancelled
}

func cancelRepositoryRunScan(ctx context.Context, db *bun.DB, scanID uuid.UUID) {
	now := time.Now()
	_, _ = db.NewUpdate().Model((*models.Scan)(nil)).
		Set("status = ?", models.ScanStatusCancelled).
		Set("current_step = ?", models.ScanStepCancelled).
		Set("error_message = ?", "Cancelled with repository run").
		Set("completed_at = ?", now).
		Set("last_progress_at = ?", now).
		Where("id = ?", scanID).
		Where("status IN (?)", bun.In([]string{models.ScanStatusPending, models.ScanStatusRunning})).
		Exec(ctx)
	_ = scanner.MarkScanCancelled(ctx, db, scanID, "Cancelled with repository run")
}

func createScan(ctx context.Context, db *bun.DB, repository models.GitRepository, runID uuid.UUID, image DiscoveredImage, registryID *uuid.UUID) (*models.Scan, []string, error) {
	var registry *models.Registry
	var envVars []string
	if registryID != nil {
		if db == nil {
			return nil, nil, fmt.Errorf("selected registry is unavailable")
		}
		var selected models.Registry
		if err := db.NewSelect().Model(&selected).Where("id = ?", *registryID).Scan(ctx); err != nil {
			return nil, nil, fmt.Errorf("selected registry is unavailable")
		}
		allowed, err := registryBelongsToRepository(ctx, db, &selected, repository)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to check selected registry access: %w", err)
		}
		if !allowed {
			return nil, nil, fmt.Errorf("selected registry is not available to this workspace")
		}
		registry, envVars, err = scanner.ResolveRegistryForScan(ctx, db, image.ImageName, registryID)
		if err != nil {
			return nil, nil, err
		}
	}
	provider, err := scanner.ProviderForRegistry(registry)
	if err != nil {
		return nil, nil, err
	}
	name, tag := scanner.NormalizeScanTarget(image.ImageName, image.ImageTag, registry)
	scan := &models.Scan{ImageName: name, ImageTag: tag, ScanProvider: provider, ScanSource: models.ScanSourceGitRepository, CurrentStep: models.ScanStepQueued, Status: models.ScanStatusPending, OwnerType: repository.OwnerType, OwnerUserID: repository.OwnerUserID, OwnerOrgID: repository.OwnerOrgID, UserID: &repository.CreatedByID, GitRepositoryRunID: &runID, CreatedAt: time.Now()}
	if registry != nil {
		scan.RegistryID = &registry.ID
	}
	if repository.OwnerType == models.OwnerTypeOrg && repository.OwnerOrgID != nil {
		scan.OwnerUserID = nil
	}
	return scan, envVars, nil
}

func attachScanTags(ctx context.Context, tx bun.Tx, scanID uuid.UUID, ids []string) error {
	for _, raw := range ids {
		id, err := uuid.Parse(raw)
		if err != nil {
			continue
		}
		if _, err := tx.NewInsert().Model(&models.ScanTag{ScanID: scanID, TagID: id}).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}
func failRun(ctx context.Context, db *bun.DB, run *models.GitRepositoryRun, err error) {
	now := time.Now()
	run.Status, run.ErrorMessage, run.CompletedAt = models.GitRepositoryRunFailed, err.Error(), &now
	db.NewUpdate().Model(run).
		Column("status", "error_message", "completed_at").
		Where("id = ?", run.ID).
		Where("status != ?", models.GitRepositoryRunCancelled).
		Exec(ctx)
}

func previousRefs(ctx context.Context, db *bun.DB, repositoryID, currentRunID uuid.UUID, registryOverrides map[string]uuid.UUID, detectedRegistryIDs ...map[string]*uuid.UUID) map[string]bool {
	var previous models.GitRepositoryRun
	if err := db.NewSelect().Model(&previous).Where("repository_id = ?", repositoryID).Where("id != ?", currentRunID).Where("trigger != ?", "dry_run").Where("status IN (?)", bun.In([]string{models.GitRepositoryRunCompleted, models.GitRepositoryRunPartial})).OrderExpr("created_at DESC").Limit(1).Scan(ctx); err != nil {
		return map[string]bool{}
	}
	var refs []struct {
		FullRef    string     `bun:"full_ref"`
		RegistryID *uuid.UUID `bun:"registry_id"`
	}
	if err := db.NewSelect().Table("git_repository_run_images").Column("full_ref", "registry_id").Where("run_id = ?", previous.ID).Scan(ctx, &refs); err != nil {
		return map[string]bool{}
	}
	result := make(map[string]bool, len(refs))
	currentRegistries := map[string]*uuid.UUID(nil)
	if len(detectedRegistryIDs) > 0 {
		currentRegistries = detectedRegistryIDs[0]
	}
	for _, ref := range refs {
		if currentRegistries != nil {
			currentRegistryID, present := currentRegistries[ref.FullRef]
			if !present || !sameRegistryID(ref.RegistryID, currentRegistryID) {
				continue
			}
			result[ref.FullRef] = true
			continue
		}
		if override, ok := registryOverrides[ref.FullRef]; ok {
			if ref.RegistryID == nil || *ref.RegistryID != override {
				continue
			}
		} else if ref.RegistryID != nil {
			continue
		}
		result[ref.FullRef] = true
	}
	return result
}

func sameRegistryID(left, right *uuid.UUID) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func imageRegistryOverrides(ctx context.Context, db *bun.DB, repositoryID uuid.UUID) map[string]uuid.UUID {
	var overrides []models.GitRepositoryImageRegistryOverride
	if err := db.NewSelect().Model(&overrides).Where("repository_id = ?", repositoryID).Scan(ctx); err != nil {
		return map[string]uuid.UUID{}
	}
	result := make(map[string]uuid.UUID, len(overrides))
	for _, override := range overrides {
		result[override.FullRef] = override.RegistryID
	}
	return result
}

func uniqueImageRefs(refs []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(refs))
	for _, ref := range refs {
		ref = strings.TrimSpace(ref)
		if ref != "" && !seen[ref] {
			seen[ref] = true
			result = append(result, ref)
		}
	}
	return result
}

func requestedDiscoveredImages(images []DiscoveredImage, refs []string) []DiscoveredImage {
	if len(refs) == 0 {
		return images
	}
	wanted := map[string]bool{}
	for _, ref := range refs {
		wanted[ref] = true
	}
	result := make([]DiscoveredImage, 0, len(refs))
	for _, image := range images {
		if wanted[image.FullRef] {
			result = append(result, image)
		}
	}
	return result
}

func excludedImageRefs(ctx context.Context, db *bun.DB, repositoryID uuid.UUID) map[string]bool {
	var refs []string
	if err := db.NewSelect().Model((*models.GitRepositoryImageExclusion)(nil)).Column("full_ref").Where("repository_id = ?", repositoryID).Scan(ctx, &refs); err != nil {
		return map[string]bool{}
	}
	result := make(map[string]bool, len(refs))
	for _, ref := range refs {
		result[ref] = true
	}
	return result
}

func reconcileLoop(db *bun.DB) {
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		var runs []models.GitRepositoryRun
		if err := db.NewSelect().Model(&runs).Where("status = ?", models.GitRepositoryRunScanning).Scan(context.Background()); err == nil {
			for _, run := range runs {
				reconcileRun(context.Background(), db, run.ID)
			}
		}
	}
}
func reconcileRun(ctx context.Context, db *bun.DB, runID uuid.UUID) {
	var rows []struct {
		Status string `bun:"status"`
		Count  int    `bun:"count"`
	}
	if err := db.NewSelect().TableExpr("git_repository_run_images AS ri").ColumnExpr("COALESCE(s.status, ri.state) AS status, COUNT(*) AS count").Join("LEFT JOIN scans AS s ON s.id = ri.scan_id").Where("ri.run_id = ?", runID).GroupExpr("COALESCE(s.status, ri.state)").Scan(ctx, &rows); err != nil {
		return
	}
	total, complete, failed, active := 0, 0, 0, 0
	for _, row := range rows {
		total += row.Count
		switch row.Status {
		case models.ScanStatusCompleted, "unchanged", "excluded":
			complete += row.Count
		case models.ScanStatusFailed:
			failed += row.Count
		default:
			active += row.Count
		}
	}
	if active > 0 {
		return
	}
	status := models.GitRepositoryRunCompleted
	var run models.GitRepositoryRun
	_ = db.NewSelect().Model(&run).Where("id = ?", runID).Scan(ctx)
	if run.UnresolvedCount > 0 || (failed > 0 && complete > 0) {
		status = models.GitRepositoryRunPartial
	} else if failed > 0 && complete == 0 && total > 0 {
		status = models.GitRepositoryRunFailed
	}
	now := time.Now()
	db.NewUpdate().Model((*models.GitRepositoryRun)(nil)).Set("status = ?", status).Set("completed_at = ?", now).Where("id = ?", runID).Exec(ctx)
}

func Discover(ctx context.Context, repository models.GitRepository) ([]DiscoveredImage, string, error) {
	images, _, commit, err := DiscoverReview(ctx, repository)
	return images, commit, err
}

// registryDiscoverySelection resolves the prefix used by registry-reference
// discovery. A configured registry is loaded and authorized against the
// repository owner before its URL is used; a manually entered prefix never
// implicitly selects a credential-bearing registry record.
func registryDiscoverySelection(ctx context.Context, repository models.GitRepository) (string, *uuid.UUID, error) {
	if repository.DiscoveryRegistryID != nil {
		if strings.TrimSpace(repository.DiscoveryRegistry) != "" {
			return "", nil, fmt.Errorf("choose a configured registry or a custom registry prefix, not both")
		}
		state.Lock()
		db := state.db
		state.Unlock()
		if db == nil {
			return "", nil, fmt.Errorf("selected registry is unavailable")
		}
		var registry models.Registry
		if err := db.NewSelect().Model(&registry).Where("id = ?", *repository.DiscoveryRegistryID).Scan(ctx); err != nil {
			return "", nil, fmt.Errorf("selected registry is unavailable")
		}
		allowed, err := registryBelongsToRepository(ctx, db, &registry, repository)
		if err != nil {
			return "", nil, fmt.Errorf("failed to check selected registry access: %w", err)
		}
		if !allowed {
			return "", nil, fmt.Errorf("selected registry is not available to this workspace")
		}
		prefix, err := normalizeConfiguredRegistryPrefix(registry.URL)
		if err != nil {
			return "", nil, fmt.Errorf("selected registry URL: %w", err)
		}
		registryID := registry.ID
		return prefix, &registryID, nil
	}
	prefix, err := NormalizeRegistryDiscoveryPrefix(repository.DiscoveryRegistry)
	if err != nil {
		return "", nil, err
	}
	return prefix, nil, nil
}

// detectImageRegistries annotates discovered images with the configured
// registry entry that would be used for an automatic scan. Only registries
// visible in the repository's workspace are considered; an otherwise matching
// registry owned by another user or organization must never become an
// implicit credential choice. Unknown hosts remain unannotated so callers can
// preserve and, where supported, scan their original fully-qualified ref.
func detectImageRegistries(ctx context.Context, repository models.GitRepository, images []DiscoveredImage) []DiscoveredImage {
	state.Lock()
	db := state.db
	state.Unlock()
	if db == nil || len(images) == 0 || repository.DiscoveryMode == models.GitRepositoryDiscoveryRegistry {
		return images
	}

	var registries []models.Registry
	if err := db.NewSelect().Model(&registries).OrderExpr("created_at DESC").Scan(ctx); err != nil {
		log.Warnf("Git repository registry detection: list registries: %v", err)
		return images
	}
	available := make([]models.Registry, 0, len(registries))
	for index := range registries {
		registry := &registries[index]
		allowed, err := registryBelongsToRepository(ctx, db, registry, repository)
		if err != nil {
			log.Warnf("Git repository registry detection: check registry %s: %v", registry.ID, err)
			continue
		}
		if allowed {
			available = append(available, *registry)
		}
	}

	for index := range images {
		if images[index].RegistryID != nil {
			continue
		}
		for registryIndex := range available {
			if scanner.RegistryMatchesImage(images[index].ImageName, &available[registryIndex]) {
				registryID := available[registryIndex].ID
				images[index].RegistryID = &registryID
				break
			}
		}
	}
	return images
}

// DiscoverReview returns proven deployment images plus paths which need an
// operator decision before JustScan can safely treat them as deployments.
func DiscoverReview(ctx context.Context, repository models.GitRepository) ([]DiscoveredImage, []DiscoveryCandidate, string, error) {
	if err := validateCloneURL(repository.CloneURL); err != nil {
		return nil, nil, "", err
	}
	dir, err := os.MkdirTemp("", "justscan-git-*")
	if err != nil {
		return nil, nil, "", err
	}
	defer os.RemoveAll(dir)
	cloneCtx, cancel := context.WithTimeout(ctx, cloneTimeout)
	defer cancel()
	if err := clone(cloneCtx, repository, dir); err != nil {
		return nil, nil, "", err
	}
	discoveryMatcher, err := newDiscoveryPathMatcher(dir, repository.DiscoveryExcludes)
	if err != nil {
		return nil, nil, "", err
	}
	commit, err := gitOutput(cloneCtx, dir, "rev-parse", "HEAD")
	if err != nil {
		return nil, nil, "", err
	}
	rules := loadDiscoveryRules(ctx, repository.ID)
	configuration, configured, configErr := loadJustScanConfig(dir)
	if configErr != nil {
		return nil, nil, strings.TrimSpace(commit), configErr
	}
	discovery, err := discoverRepositoryWithMatcher(ctx, dir, repository, discoveryMatcher)
	if err != nil {
		return nil, nil, strings.TrimSpace(commit), err
	}
	images := discovery.images
	managedImages, err := discoverManagedHelmSources(ctx, dir, repository, discoveryMatcher)
	if err != nil {
		return nil, nil, strings.TrimSpace(commit), err
	}
	images = mergeDiscoveredImages(images, managedImages)
	managedSources, err := loadHelmSources(ctx, repository.ID)
	if err != nil {
		return nil, nil, strings.TrimSpace(commit), err
	}
	if !configured && len(rules) > 0 {
		if resolved, err := discoverRuleSourcesWithMatcher(ctx, dir, rules, repository, discoveryMatcher); err == nil {
			images = mergeDiscoveredImages(images, resolved)
		}
	}
	if configured {
		rules = nil // A committed repository configuration takes precedence over UI rules.
	}
	images = detectImageRegistries(ctx, repository, images)
	candidates := findDiscoveryCandidatesWithMatcher(dir, rules, configuration, managedSources, discoveryMatcher)
	candidates = append(candidates, discovery.warnings...)
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].Path < candidates[j].Path })
	return images, candidates, strings.TrimSpace(commit), nil
}

func loadDiscoveryRules(ctx context.Context, repositoryID uuid.UUID) []models.GitRepositoryDiscoveryRule {
	state.Lock()
	db := state.db
	state.Unlock()
	if db == nil {
		return nil
	}
	var rules []models.GitRepositoryDiscoveryRule
	if err := db.NewSelect().Model(&rules).Where("repository_id = ? AND active = true", repositoryID).OrderExpr("created_at ASC").Scan(ctx); err != nil {
		return nil
	}
	return rules
}

func loadHelmSources(ctx context.Context, repositoryID uuid.UUID) ([]models.GitRepositoryHelmSource, error) {
	state.Lock()
	db := state.db
	state.Unlock()
	if db == nil {
		return nil, nil
	}
	var sources []models.GitRepositoryHelmSource
	if err := db.NewSelect().Model(&sources).Where("repository_id = ?", repositoryID).OrderExpr("created_at ASC").Scan(ctx); err != nil {
		return nil, err
	}
	return sources, nil
}

// Managed Helm sources are deliberately independent of repository-owned
// .justscan.yaml configuration: connector IDs and encrypted credentials cannot
// be committed safely, and an external chart can complement local sources.
func discoverManagedHelmSources(ctx context.Context, repositoryRoot string, repository models.GitRepository, discoveryMatcher discoveryPathMatcher) ([]DiscoveredImage, error) {
	sources, err := loadHelmSources(ctx, repository.ID)
	if err != nil || len(sources) == 0 {
		return nil, err
	}
	state.Lock()
	db := state.db
	state.Unlock()
	byRef := map[string]*DiscoveredImage{}
	for _, source := range sources {
		for _, configuredValue := range source.Values {
			valuePath, valueErr := resolveRepositoryPath(repositoryRoot, configuredValue)
			if valueErr != nil {
				return nil, valueErr
			}
			if discoveryMatcher.Excluded(valuePath) {
				return nil, fmt.Errorf("managed Helm values path %q is excluded", configuredValue)
			}
		}
		chartRoot := repositoryRoot
		chartLabel := relativePath(repositoryRoot, filepath.Join(repositoryRoot, source.ChartPath))
		var removeChartRoot func()
		switch source.SourceType {
		case "local":
			chartPath, chartErr := resolveRepositoryPath(repositoryRoot, source.ChartPath)
			if chartErr != nil {
				return nil, chartErr
			}
			if discoveryMatcher.Excluded(chartPath) {
				return nil, fmt.Errorf("managed Helm chart path %q is excluded", source.ChartPath)
			}
			chartLabel = relativePath(repositoryRoot, filepath.Join(repositoryRoot, source.ChartPath))
		case "repository", "url":
			chartRepository, err := managedHelmChartRepository(ctx, db, source)
			if err != nil {
				return nil, err
			}
			chartRoot, err = os.MkdirTemp("", "justscan-git-chart-*")
			if err != nil {
				return nil, err
			}
			removeChartRoot = func() { _ = os.RemoveAll(chartRoot) }
			cloneCtx, cancel := context.WithTimeout(ctx, cloneTimeout)
			err = clone(cloneCtx, chartRepository, chartRoot)
			cancel()
			if err != nil {
				removeChartRoot()
				return nil, fmt.Errorf("clone Helm chart source: %w", err)
			}
			chartLabel = fmt.Sprintf("%s@%s:%s", chartRepository.Name, chartRepository.Ref, filepath.ToSlash(source.ChartPath))
		default:
			return nil, fmt.Errorf("unsupported managed Helm source type %q", source.SourceType)
		}
		if removeChartRoot != nil {
			defer removeChartRoot()
		}
		if err := appendHelmChartFromRoots(ctx, repositoryRoot, chartRoot, byRef, justScanSource{Chart: source.ChartPath, Values: source.Values, ReleaseName: source.ReleaseName}, chartLabel, repository, source.DependencyRegistryID, source.HelmRegistryCredentialID); err != nil {
			return nil, fmt.Errorf("managed Helm source %s: %w", source.ChartPath, err)
		}
	}
	return sortedDiscoveredImages(byRef), nil
}

func managedHelmChartRepository(ctx context.Context, db *bun.DB, source models.GitRepositoryHelmSource) (models.GitRepository, error) {
	if source.SourceType == "url" {
		return models.GitRepository{CloneURL: source.CloneURL, Ref: source.Ref, AuthType: source.AuthType, Username: source.Username, EncryptedCredential: source.EncryptedCredential, Name: source.CloneURL}, nil
	}
	if source.ChartRepositoryID == nil || db == nil {
		return models.GitRepository{}, fmt.Errorf("linked chart repository is unavailable")
	}
	var repository models.GitRepository
	if err := db.NewSelect().Model(&repository).Where("id = ?", *source.ChartRepositoryID).Scan(ctx); err != nil {
		return models.GitRepository{}, fmt.Errorf("linked chart repository is unavailable")
	}
	return repository, nil
}

func discoverRuleSources(ctx context.Context, root string, rules []models.GitRepositoryDiscoveryRule, repository models.GitRepository) ([]DiscoveredImage, error) {
	discoveryMatcher, err := newDiscoveryPathMatcher(root, repository.DiscoveryExcludes)
	if err != nil {
		return nil, err
	}
	return discoverRuleSourcesWithMatcher(ctx, root, rules, repository, discoveryMatcher)
}

func discoverRuleSourcesWithMatcher(ctx context.Context, root string, rules []models.GitRepositoryDiscoveryRule, repository models.GitRepository, discoveryMatcher discoveryPathMatcher) ([]DiscoveredImage, error) {
	configuration := justScanConfig{Version: 1}
	for _, rule := range rules {
		if rule.Resolution == "ignore" {
			continue
		}
		var source justScanSource
		bytes, _ := json.Marshal(rule.Config)
		if json.Unmarshal(bytes, &source) != nil {
			continue
		}
		source.Type = rule.Resolution
		if len(source.Paths) == 0 && (source.Type == "kustomize" || source.Type == "manifests") {
			source.Paths = []string{rule.PathPattern}
		}
		configuration.Discovery.Sources = append(configuration.Discovery.Sources, source)
	}
	if len(configuration.Discovery.Sources) == 0 {
		return nil, nil
	}
	discovery, err := discoverConfiguredSourcesWithMatcher(ctx, root, configuration, repository, discoveryMatcher)
	return discovery.images, err
}

func mergeDiscoveredImages(groups ...[]DiscoveredImage) []DiscoveredImage {
	byRef := map[string]*DiscoveredImage{}
	for _, images := range groups {
		for _, image := range images {
			item := byRef[image.FullRef]
			if item == nil {
				copy := image
				copy.Locations = nil
				item = &copy
				byRef[image.FullRef] = item
			}
			item.Locations = append(item.Locations, image.Locations...)
		}
	}
	return sortedDiscoveredImages(byRef)
}

func findDiscoveryCandidates(root string, rules []models.GitRepositoryDiscoveryRule, configuration justScanConfig, helmSources []models.GitRepositoryHelmSource) []DiscoveryCandidate {
	discoveryMatcher := emptyDiscoveryPathMatcher(root)
	return findDiscoveryCandidatesWithMatcher(root, rules, configuration, helmSources, discoveryMatcher)
}

func findDiscoveryCandidatesWithMatcher(root string, rules []models.GitRepositoryDiscoveryRule, configuration justScanConfig, helmSources []models.GitRepositoryHelmSource, discoveryMatcher discoveryPathMatcher) []DiscoveryCandidate {
	result := []DiscoveryCandidate{}
	consumedValues := kustomizeValuesFilesWithMatcher(root, discoveryMatcher)
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry == nil {
			return nil
		}
		if discoveryMatcher.Excluded(path) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			if entry != nil && entry.IsDir() && (entry.Name() == ".git" || (path != root && isAutoDiscoveryFixtureDirectory(relativePath(root, path)))) {
				return filepath.SkipDir
			}
			return nil
		}
		name := strings.ToLower(entry.Name())
		if name != "values.yaml" && name != "values.yml" && name != "chart.yaml" {
			return nil
		}
		if (name == "values.yaml" || name == "values.yml") && (consumedValues[filepath.Clean(path)] || kustomizationFilename(filepath.Dir(path)) != "" || chartFilename(filepath.Dir(path)) != "") {
			return nil
		}
		kind, confidence := "helm_values", "ambiguous"
		if name == "chart.yaml" {
			kind = "helm_chart"
		}
		candidate := DiscoveryCandidate{Path: relativePath(root, path), DetectedType: kind, Confidence: confidence, Evidence: models.JSONObject{"marker": entry.Name(), "directory": relativePath(root, filepath.Dir(path))}, Status: models.GitRepositoryCandidateUnresolved}
		for _, rule := range rules {
			if rule.PathPattern != candidate.Path {
				continue
			}
			candidate.RuleID = &rule.ID
			if rule.Resolution == "ignore" {
				candidate.Status = models.GitRepositoryCandidateIgnored
			} else {
				candidate.Status = models.GitRepositoryCandidateResolved
			}
			break
		}
		if candidate.Status == models.GitRepositoryCandidateUnresolved {
			for _, source := range helmSources {
				if containsSourceValue(source.Values, candidate.Path) {
					candidate.Status = models.GitRepositoryCandidateResolved
					break
				}
			}
		}
		if candidate.Status == models.GitRepositoryCandidateUnresolved {
			for _, rule := range configuration.Discovery.Rules {
				if rule.Match != candidate.Path {
					continue
				}
				if rule.Type == "ignore" {
					candidate.Status = models.GitRepositoryCandidateIgnored
				} else {
					candidate.Status = models.GitRepositoryCandidateAutoAccepted
				}
				break
			}
		}
		result = append(result, candidate)
		return nil
	})
	sort.Slice(result, func(i, j int) bool { return result[i].Path < result[j].Path })
	return result
}

func containsSourceValue(values []string, path string) bool {
	for _, value := range values {
		if filepath.ToSlash(strings.TrimSpace(value)) == path {
			return true
		}
	}
	return false
}

func chartFilename(path string) string {
	for _, name := range []string{"Chart.yaml", "Chart.yml"} {
		if info, err := os.Stat(filepath.Join(path, name)); err == nil && !info.IsDir() {
			return name
		}
	}
	return ""
}

func kustomizeValuesFiles(root string) map[string]bool {
	return kustomizeValuesFilesWithMatcher(root, emptyDiscoveryPathMatcher(root))
}

func kustomizeValuesFilesWithMatcher(root string, discoveryMatcher discoveryPathMatcher) map[string]bool {
	result := map[string]bool{}
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry == nil {
			return nil
		}
		if discoveryMatcher.Excluded(path) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() || !isKustomizationFile(entry.Name()) {
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		var document map[string]any
		if yaml.Unmarshal(content, &document) != nil {
			return nil
		}
		charts, _ := document["helmCharts"].([]any)
		for _, raw := range charts {
			chart, _ := raw.(map[string]any)
			valueFile, _ := chart["valuesFile"].(string)
			if valueFile == "" || strings.Contains(valueFile, "://") {
				continue
			}
			candidate := filepath.Clean(filepath.Join(filepath.Dir(path), valueFile))
			if pathWithin(root, candidate) {
				result[candidate] = true
			}
		}
		return nil
	})
	return result
}

func unresolvedCandidates(candidates []DiscoveryCandidate) int {
	count := 0
	for _, candidate := range candidates {
		if candidate.Status == models.GitRepositoryCandidateUnresolved {
			count++
		}
	}
	return count
}

func clone(ctx context.Context, repository models.GitRepository, dir string) error {
	if repository.AuthType != models.GitRepositoryAuthNone {
		if strings.TrimSpace(repository.Username) == "" {
			return fmt.Errorf("clone repository: Git username is missing from the connector")
		}
		if repository.EncryptedCredential == "" {
			return fmt.Errorf("clone repository: Git token or password is missing from the connector")
		}
	}

	// Run with a blank credential helper so a system/global Git configuration
	// cannot return stale credentials before JustScan's provider runs.
	args := []string{"-c", "credential.helper="}
	var credentialHelper string
	var secret string
	if repository.AuthType != models.GitRepositoryAuthNone && repository.EncryptedCredential != "" {
		decryptedSecret, err := crypto.Decrypt(crypto.KeyFromString(config.Config.Encryption.Key), repository.EncryptedCredential)
		if err != nil {
			return fmt.Errorf("decrypt Git credential: %w", err)
		}
		secret = decryptedSecret
		credentialHelper, err = createGitCredentialHelper(filepath.Dir(dir))
		if err != nil {
			return err
		}
		defer os.Remove(credentialHelper)
		// A ! helper is executed as a command by Git. The secret stays in the
		// process environment rather than appearing in the clone URL or argv.
		args = append(args, "-c", "credential.helper=!"+credentialHelper)
	}
	args = append(args, "clone", "--depth", "1", "--no-tags")
	ref := strings.TrimSpace(repository.Ref)
	if ref != "" && ref != "HEAD" {
		args = append(args, "--branch", ref)
	}
	args = append(args, repository.CloneURL, dir)
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Env = append(os.Environ(),
		"GIT_TERMINAL_PROMPT=0",
		"GIT_CONFIG_NOSYSTEM=1",
	)
	if credentialHelper != "" {
		cmd.Env = append(cmd.Env, "JUSTSCAN_GIT_USERNAME="+repository.Username, "JUSTSCAN_GIT_SECRET="+secret)
	}
	cloneHost := ""
	if parsedURL, err := url.Parse(repository.CloneURL); err == nil {
		cloneHost = parsedURL.Hostname()
	}
	log.WithFields(log.Fields{
		"repository_id":         repository.ID,
		"host":                  cloneHost,
		"auth_type":             repository.AuthType,
		"username":              repository.Username,
		"credential_configured": credentialHelper != "",
		"credential_length":     len(secret),
		"custom_ca_configured":  strings.TrimSpace(os.Getenv("GIT_SSL_CAINFO")) != "",
	}).Debug("Git repository clone starting")
	output, err := cmd.CombinedOutput()
	if err != nil {
		if repository.AuthType != models.GitRepositoryAuthNone {
			return fmt.Errorf(
				"clone repository using %s authentication as %q: %s",
				repository.AuthType,
				repository.Username,
				redactGitError(string(output)),
			)
		}
		return fmt.Errorf("clone repository: %s", redactGitError(string(output)))
	}
	return nil
}

func createGitCredentialHelper(dir string) (string, error) {
	file, err := os.CreateTemp(dir, "justscan-git-credential-helper-*.sh")
	if err != nil {
		return "", fmt.Errorf("create Git credential helper: %w", err)
	}
	path := file.Name()
	removeOnError := true
	defer func() {
		_ = file.Close()
		if removeOnError {
			_ = os.Remove(path)
		}
	}()

	helperScript := "#!/bin/sh\ncase \"${1:-}\" in\n  get) printf 'username=%s\\npassword=%s\\n\\n' \"$JUSTSCAN_GIT_USERNAME\" \"$JUSTSCAN_GIT_SECRET\" ;;\nesac\n"
	if _, err := file.WriteString(helperScript); err != nil {
		return "", fmt.Errorf("write Git credential helper: %w", err)
	}
	if err := file.Chmod(0700); err != nil {
		return "", fmt.Errorf("secure Git credential helper: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close Git credential helper: %w", err)
	}
	removeOnError = false
	return path, nil
}

func gitOutput(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(output), nil
}
func validateCloneURL(raw string) error {
	if !strings.HasPrefix(raw, "https://") && !strings.HasPrefix(raw, "http://") {
		return fmt.Errorf("repository URL must use http:// or https://")
	}
	if strings.Contains(strings.TrimPrefix(strings.TrimPrefix(raw, "https://"), "http://"), "@") {
		return fmt.Errorf("repository URL must not contain credentials")
	}
	return nil
}
func redactGitError(text string) string { return strings.TrimSpace(text) }
func defaultTimezone(value string) string {
	if strings.TrimSpace(value) == "" {
		return "UTC"
	}
	return value
}

func discoverRepository(ctx context.Context, root string, repository models.GitRepository) ([]DiscoveredImage, error) {
	discoveryMatcher, err := newDiscoveryPathMatcher(root, repository.DiscoveryExcludes)
	if err != nil {
		return nil, err
	}
	discovery, err := discoverRepositoryWithMatcher(ctx, root, repository, discoveryMatcher)
	if err != nil {
		return nil, err
	}
	return discovery.images, nil
}

func discoverRepositoryWithMatcher(ctx context.Context, root string, repository models.GitRepository, discoveryMatcher discoveryPathMatcher) (repositoryDiscoveryResult, error) {
	if repositoryConfig, configured, err := loadJustScanConfig(root); err != nil {
		return repositoryDiscoveryResult{}, err
	} else if configured {
		return discoverConfiguredSourcesWithMatcher(ctx, root, repositoryConfig, repository, discoveryMatcher)
	}
	mode := repository.DiscoveryMode
	if mode == "" {
		mode = models.GitRepositoryDiscoveryAuto
	}
	if mode == models.GitRepositoryDiscoveryManifests {
		images, err := discoverYAMLWithMatcher(root, discoveryMatcher)
		return repositoryDiscoveryResult{images: images}, err
	}
	if mode == models.GitRepositoryDiscoveryRegistry {
		prefix, registryID, err := registryDiscoverySelection(ctx, repository)
		if err != nil {
			return repositoryDiscoveryResult{}, err
		}
		images, err := discoverRegistryWithMatcher(root, prefix, discoveryMatcher)
		if err != nil {
			return repositoryDiscoveryResult{}, err
		}
		if registryID != nil {
			for index := range images {
				images[index].RegistryID = registryID
			}
		}
		return repositoryDiscoveryResult{images: images}, nil
	}
	if mode == models.GitRepositoryDiscoveryGitLabCI {
		images, err := discoverGitLabCIWithMatcher(root, repository.Entrypoints, discoveryMatcher)
		return repositoryDiscoveryResult{images: images}, err
	}
	explicitEntrypoints := len(repository.Entrypoints) > 0
	roots, err := findKustomizationRootsWithMatcher(root, repository.Entrypoints, discoveryMatcher)
	if err != nil {
		return repositoryDiscoveryResult{}, err
	}
	if len(roots) == 0 {
		if mode == models.GitRepositoryDiscoveryKustomize {
			return repositoryDiscoveryResult{}, fmt.Errorf("no Kustomize entrypoints found")
		}
		images, err := discoverYAMLWithMatcher(root, discoveryMatcher)
		return repositoryDiscoveryResult{images: images}, err
	}
	images, warnings, err := discoverKustomizeRootsWithMatcher(root, roots, discoveryMatcher, explicitEntrypoints)
	return repositoryDiscoveryResult{images: images, warnings: warnings}, err
}

func loadJustScanConfig(root string) (justScanConfig, bool, error) {
	for _, name := range []string{".justscan.yaml", ".justscan.yml"} {
		content, err := os.ReadFile(filepath.Join(root, name))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return justScanConfig{}, false, fmt.Errorf("read %s: %w", name, err)
		}
		var configuration justScanConfig
		if err := yaml.Unmarshal(content, &configuration); err != nil {
			return justScanConfig{}, false, fmt.Errorf("parse %s: %w", name, err)
		}
		if configuration.Version != 1 {
			return justScanConfig{}, false, fmt.Errorf("%s requires version: 1", name)
		}
		if len(configuration.Discovery.Sources) == 0 && len(configuration.Discovery.Rules) == 0 {
			return justScanConfig{}, false, fmt.Errorf("%s must define discovery.sources or discovery.rules", name)
		}
		return configuration, true, nil
	}
	return justScanConfig{}, false, nil
}

func discoverConfiguredSources(ctx context.Context, root string, configuration justScanConfig, repository models.GitRepository) ([]DiscoveredImage, error) {
	discoveryMatcher, err := newDiscoveryPathMatcher(root, repository.DiscoveryExcludes)
	if err != nil {
		return nil, err
	}
	discovery, err := discoverConfiguredSourcesWithMatcher(ctx, root, configuration, repository, discoveryMatcher)
	return discovery.images, err
}

func discoverConfiguredSourcesWithMatcher(ctx context.Context, root string, configuration justScanConfig, repository models.GitRepository, discoveryMatcher discoveryPathMatcher) (repositoryDiscoveryResult, error) {
	byRef := map[string]*DiscoveredImage{}
	warnings := []DiscoveryCandidate{}
	sources := append([]justScanSource{}, configuration.Discovery.Sources...)
	for _, rule := range configuration.Discovery.Rules {
		source := justScanSource{Type: rule.Type, Chart: rule.Chart, Values: rule.Values, ReleaseName: rule.ReleaseName, Paths: rule.Paths}
		if len(source.Paths) == 0 && rule.Match != "" && (rule.Type == "kustomize" || rule.Type == "manifests" || rule.Type == "gitlab_ci") {
			source.Paths = []string{rule.Match}
		}
		if rule.Type != "ignore" {
			sources = append(sources, source)
		}
	}
	for index, source := range sources {
		source.Type = strings.ToLower(strings.TrimSpace(source.Type))
		switch source.Type {
		case "kustomize":
			var roots []string
			var err error
			explicitRoots := len(source.Paths) > 0
			if len(source.Paths) > 0 {
				roots, err = findKustomizationRootsWithMatcher(root, source.Paths, discoveryMatcher)
			} else {
				discoveryRoot, resolveErr := resolveRepositoryPath(root, source.Root)
				if resolveErr != nil {
					err = resolveErr
				} else if discoveryMatcher.Excluded(discoveryRoot) {
					err = fmt.Errorf("Kustomize discovery root %q is excluded", source.Root)
				} else {
					roots, err = findKustomizationRootsWithMatcher(discoveryRoot, nil, discoveryMatcher)
				}
			}
			if err != nil {
				return repositoryDiscoveryResult{}, fmt.Errorf(".justscan.yaml source %d (kustomize): %w", index+1, err)
			}
			if len(roots) == 0 {
				return repositoryDiscoveryResult{}, fmt.Errorf(".justscan.yaml source %d (kustomize): no entrypoints found", index+1)
			}
			rootWarnings, err := appendKustomizeRootsWithMatcher(root, byRef, roots, discoveryMatcher, explicitRoots)
			if err != nil {
				return repositoryDiscoveryResult{}, fmt.Errorf(".justscan.yaml source %d (kustomize): %w", index+1, err)
			}
			warnings = append(warnings, rootWarnings...)
		case "manifests":
			if len(source.Paths) == 0 {
				return repositoryDiscoveryResult{}, fmt.Errorf(".justscan.yaml source %d (manifests): paths is required", index+1)
			}
			if err := appendManifestPathsWithMatcher(root, byRef, source.Paths, discoveryMatcher); err != nil {
				return repositoryDiscoveryResult{}, fmt.Errorf(".justscan.yaml source %d (manifests): %w", index+1, err)
			}
		case "gitlab_ci", "gitlab-ci", "gitlab":
			paths := source.Paths
			if len(paths) == 0 && strings.TrimSpace(source.Root) != "" {
				paths = []string{source.Root}
			}
			images, err := discoverGitLabCIWithMatcher(root, paths, discoveryMatcher)
			if err != nil {
				return repositoryDiscoveryResult{}, fmt.Errorf(".justscan.yaml source %d (gitlab_ci): %w", index+1, err)
			}
			for _, image := range images {
				item := image
				item.Locations = nil
				if existing := byRef[image.FullRef]; existing != nil {
					existing.Locations = append(existing.Locations, image.Locations...)
					continue
				}
				item.Locations = append(item.Locations, image.Locations...)
				byRef[image.FullRef] = &item
			}
		case "helm":
			chartPath, chartErr := resolveRepositoryPath(root, source.Chart)
			if chartErr != nil {
				return repositoryDiscoveryResult{}, fmt.Errorf(".justscan.yaml source %d (helm): %w", index+1, chartErr)
			}
			if discoveryMatcher.Excluded(chartPath) {
				return repositoryDiscoveryResult{}, fmt.Errorf(".justscan.yaml source %d (helm): chart path %q is excluded", index+1, source.Chart)
			}
			for _, configuredValue := range source.Values {
				valuePath, valueErr := resolveRepositoryPath(root, configuredValue)
				if valueErr != nil {
					return repositoryDiscoveryResult{}, fmt.Errorf(".justscan.yaml source %d (helm): %w", index+1, valueErr)
				}
				if discoveryMatcher.Excluded(valuePath) {
					return repositoryDiscoveryResult{}, fmt.Errorf(".justscan.yaml source %d (helm): values path %q is excluded", index+1, configuredValue)
				}
			}
			if err := appendHelmChartFromRoots(ctx, root, root, byRef, source, "", repository, nil, nil); err != nil {
				return repositoryDiscoveryResult{}, fmt.Errorf(".justscan.yaml source %d (helm): %w", index+1, err)
			}
		default:
			return repositoryDiscoveryResult{}, fmt.Errorf(".justscan.yaml source %d has unsupported type %q", index+1, source.Type)
		}
	}
	return repositoryDiscoveryResult{images: sortedDiscoveredImages(byRef), warnings: warnings}, nil
}

func resolveRepositoryPath(root, relative string) (string, error) {
	relative = strings.TrimSpace(relative)
	if relative == "" {
		return "", fmt.Errorf("a relative repository path is required")
	}
	path := filepath.Clean(filepath.Join(root, relative))
	if !pathWithin(root, path) {
		return "", fmt.Errorf("path %q is outside the repository", relative)
	}
	return path, nil
}

// discoverYAML is the generic fallback for repositories containing plain
// Kubernetes manifests. It intentionally ignores Helm values and other
// declarations because those are not proof that an image is deployed.
func discoverYAML(root string) ([]DiscoveredImage, error) {
	return discoverYAMLWithMatcher(root, emptyDiscoveryPathMatcher(root))
}

func discoverYAMLWithMatcher(root string, discoveryMatcher discoveryPathMatcher) ([]DiscoveredImage, error) {
	byRef := map[string]*DiscoveredImage{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry == nil {
			return nil
		}
		if discoveryMatcher.Excluded(path) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			if entry.Name() == ".git" {
				return filepath.SkipDir
			}
			if path != root && isAutoDiscoveryFixtureDirectory(relativePath(root, path)) {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".yaml" && ext != ".yml" {
			return nil
		}
		info, err := entry.Info()
		if err != nil || info.Size() > maxManifestBytes {
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		appendManifestImages(byRef, content, relativePath(root, path), "")
		return nil
	})
	if err != nil {
		return nil, err
	}
	result := make([]DiscoveredImage, 0, len(byRef))
	for _, image := range byRef {
		result = append(result, *image)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].FullRef < result[j].FullRef })
	return result, nil
}

// Automatic discovery avoids common documentation and fixture directories.
// They often intentionally contain incomplete Kustomize examples. Operators
// can still select one explicitly through the configured entrypoints mode.
func isAutoDiscoveryFixtureDirectory(relative string) bool {
	for _, segment := range strings.Split(filepath.ToSlash(relative), "/") {
		switch strings.ToLower(segment) {
		case ".guide", ".github", "docs", "doc", "examples", "example", "testdata":
			return true
		}
	}
	return false
}

func discoverKustomizeRoots(root string, roots []string) ([]DiscoveredImage, error) {
	images, _, err := discoverKustomizeRootsWithMatcher(root, roots, emptyDiscoveryPathMatcher(root), true)
	return images, err
}

func discoverKustomizeRootsWithMatcher(root string, roots []string, discoveryMatcher discoveryPathMatcher, failOnRenderError bool) ([]DiscoveredImage, []DiscoveryCandidate, error) {
	byRef := map[string]*DiscoveredImage{}
	warnings, err := appendKustomizeRootsWithMatcher(root, byRef, roots, discoveryMatcher, failOnRenderError)
	if err != nil {
		return nil, nil, err
	}
	return sortedDiscoveredImages(byRef), warnings, nil
}

func appendKustomizeRoots(root string, byRef map[string]*DiscoveredImage, roots []string) error {
	_, err := appendKustomizeRootsWithMatcher(root, byRef, roots, emptyDiscoveryPathMatcher(root), true)
	return err
}

func appendKustomizeRootsWithMatcher(root string, byRef map[string]*DiscoveredImage, roots []string, discoveryMatcher discoveryPathMatcher, failOnRenderError bool) ([]DiscoveryCandidate, error) {
	warnings := []DiscoveryCandidate{}
	for _, target := range roots {
		if discoveryMatcher.Excluded(target) {
			return nil, fmt.Errorf("Kustomize entrypoint %q is excluded", relativePath(root, target))
		}
		output, err := renderKustomization(target)
		if err != nil {
			if failOnRenderError {
				return nil, fmt.Errorf("render %s: %w", relativePath(root, target), err)
			}
			path := relativePath(root, filepath.Join(target, kustomizationFilename(target)))
			warnings = append(warnings, DiscoveryCandidate{
				Path:         path,
				DetectedType: "kustomize",
				Confidence:   "ambiguous",
				Evidence:     models.JSONObject{"error": err.Error(), "directory": relativePath(root, target)},
				Status:       models.GitRepositoryCandidateUnresolved,
			})
			continue
		}
		entrypoint := relativePath(root, filepath.Join(target, kustomizationFilename(target)))
		appendManifestImages(byRef, output, "(rendered)", entrypoint)
	}
	return warnings, nil
}

func appendManifestPaths(root string, byRef map[string]*DiscoveredImage, paths []string) error {
	return appendManifestPathsWithMatcher(root, byRef, paths, emptyDiscoveryPathMatcher(root))
}

func appendManifestPathsWithMatcher(root string, byRef map[string]*DiscoveredImage, paths []string, discoveryMatcher discoveryPathMatcher) error {
	for _, configuredPath := range paths {
		path, err := resolveRepositoryPath(root, configuredPath)
		if err != nil {
			return err
		}
		if discoveryMatcher.Excluded(path) {
			return fmt.Errorf("manifest path %q is excluded", configuredPath)
		}
		info, err := os.Stat(path)
		if err != nil {
			return err
		}
		if info.IsDir() {
			err = filepath.WalkDir(path, func(candidate string, entry os.DirEntry, walkErr error) error {
				if walkErr != nil {
					return walkErr
				}
				if entry == nil {
					return nil
				}
				if discoveryMatcher.Excluded(candidate) {
					if entry.IsDir() {
						return filepath.SkipDir
					}
					return nil
				}
				if entry.IsDir() {
					if entry.Name() == ".git" {
						return filepath.SkipDir
					}
					return nil
				}
				return appendManifestFile(root, byRef, candidate)
			})
			if err != nil {
				return err
			}
			continue
		}
		if err := appendManifestFile(root, byRef, path); err != nil {
			return err
		}
	}
	return nil
}

func appendManifestFile(root string, byRef map[string]*DiscoveredImage, path string) error {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".yaml" && ext != ".yml" {
		return nil
	}
	info, err := os.Stat(path)
	if err != nil || info.Size() > maxManifestBytes {
		return nil
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	appendManifestImages(byRef, content, relativePath(root, path), "")
	return nil
}

func appendHelmChart(ctx context.Context, root string, byRef map[string]*DiscoveredImage, source justScanSource) error {
	return appendHelmChartFromRoots(ctx, root, root, byRef, source, "", models.GitRepository{}, nil, nil)
}

func appendHelmChartFromRoots(ctx context.Context, valuesRoot, chartRoot string, byRef map[string]*DiscoveredImage, source justScanSource, chartLabel string, repository models.GitRepository, dependencyRegistryID *uuid.UUID, helmCredentialIDs ...*uuid.UUID) error {
	var helmRegistryCredentialID *uuid.UUID
	if len(helmCredentialIDs) > 0 {
		helmRegistryCredentialID = helmCredentialIDs[0]
	}
	chart, err := resolveRepositoryPath(chartRoot, source.Chart)
	if err != nil {
		return fmt.Errorf("chart: %w", err)
	}
	if info, err := os.Stat(chart); err != nil || !info.IsDir() {
		return fmt.Errorf("chart %q is not a directory", source.Chart)
	}
	releaseName := strings.TrimSpace(source.ReleaseName)
	if releaseName == "" {
		releaseName = filepath.Base(chart)
	}
	args := []string{"template", releaseName, chart}
	if chartLabel == "" {
		chartLabel = relativePath(chartRoot, chart)
	}
	target := "Helm chart " + chartLabel
	for _, configuredValue := range source.Values {
		valueFile, err := resolveRepositoryPath(valuesRoot, configuredValue)
		if err != nil {
			return fmt.Errorf("values: %w", err)
		}
		args = append(args, "--values", valueFile)
		// Values are applied in order, so the final file is the most useful
		// deployment entrypoint to show in the discovery tree.
		target = "Helm values " + relativePath(valuesRoot, valueFile)
	}
	temporaryHelmHome, err := os.MkdirTemp("", "justscan-helm-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporaryHelmHome)
	helmEnv, err := helmEnvironment(ctx, temporaryHelmHome, chart, repository, dependencyRegistryID, helmRegistryCredentialID)
	if err != nil {
		return err
	}
	dependencyCommand := exec.CommandContext(ctx, "helm", "dependency", "build", chart)
	dependencyCommand.Env = helmEnv
	if output, err := dependencyCommand.CombinedOutput(); err != nil {
		return fmt.Errorf("resolve chart dependencies for %s: %s", chartLabel, strings.TrimSpace(string(output)))
	}
	command := exec.CommandContext(ctx, "helm", args...)
	command.Env = helmEnv
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("render chart %s: %s", chartLabel, strings.TrimSpace(string(output)))
	}
	appendManifestImages(byRef, output, "(rendered)", target)
	return nil
}

type helmDependencyFile struct {
	Dependencies []helmDependency `yaml:"dependencies"`
}

type helmDependency struct {
	Repository string `yaml:"repository"`
}

// helmEnvironment isolates Helm's state for every render. It also logs into
// registries owned by the same workspace before Helm resolves OCI or HTTP
// dependencies declared in Chart.yaml.
func helmEnvironment(ctx context.Context, home, chart string, repository models.GitRepository, dependencyRegistryID, helmRegistryCredentialID *uuid.UUID) ([]string, error) {
	environment := append(os.Environ(),
		"HELM_CONFIG_HOME="+home,
		"HELM_CACHE_HOME="+filepath.Join(home, "cache"),
		"HELM_DATA_HOME="+filepath.Join(home, "data"),
		"HELM_REGISTRY_CONFIG="+filepath.Join(home, "registry.json"),
		"HELM_REPOSITORY_CONFIG="+filepath.Join(home, "repositories.yaml"),
	)
	content, err := os.ReadFile(filepath.Join(chart, "Chart.yaml"))
	if err != nil {
		return nil, fmt.Errorf("read Chart.yaml: %w", err)
	}
	var metadata helmDependencyFile
	if err := yaml.Unmarshal(content, &metadata); err != nil {
		return nil, fmt.Errorf("parse Chart.yaml: %w", err)
	}
	if len(metadata.Dependencies) == 0 {
		return environment, nil
	}
	state.Lock()
	db := state.db
	state.Unlock()
	if db == nil {
		return environment, nil
	}
	var credentials []models.HelmRegistryCredential
	if err := db.NewSelect().Model(&credentials).OrderExpr("created_at DESC").Scan(ctx); err != nil {
		return nil, fmt.Errorf("load Helm registry credentials: %w", err)
	}
	var registries []models.Registry
	var selectedRegistry *models.Registry
	var selectedCredential *models.HelmRegistryCredential
	if helmRegistryCredentialID != nil {
		for index := range credentials {
			if credentials[index].ID == *helmRegistryCredentialID {
				selectedCredential = &credentials[index]
				break
			}
		}
		if selectedCredential == nil {
			return nil, fmt.Errorf("selected Helm registry credential is unavailable")
		}
		allowed, err := authz.HelmRegistryCredentialBelongsToRepository(ctx, db, &repository, selectedCredential)
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, fmt.Errorf("selected Helm registry credential is not available to this workspace")
		}
	}
	// Legacy normal registries are intentionally loaded only for an existing
	// explicit link. New automatic matching never consults them.
	if dependencyRegistryID != nil {
		if err := db.NewSelect().Model(&registries).OrderExpr("created_at DESC").Scan(ctx); err != nil {
			return nil, fmt.Errorf("load legacy Helm dependency registry: %w", err)
		}
		for index := range registries {
			if registries[index].ID == *dependencyRegistryID {
				selectedRegistry = &registries[index]
				break
			}
		}
		if selectedRegistry == nil {
			return nil, fmt.Errorf("selected Helm dependency registry is unavailable")
		}
		allowed, err := registryBelongsToRepository(ctx, db, selectedRegistry, repository)
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, fmt.Errorf("selected Helm dependency registry is not available to this workspace")
		}
	}
	configuredHosts := map[string]bool{}
	ociRegistries := []helmRegistryCredential{}
	httpRepositories := []helmRepositoryCredential{}
	selectedRegistryMatched := false
	for _, dependency := range metadata.Dependencies {
		endpoint := strings.TrimSpace(dependency.Repository)
		host := helmRepositoryHost(endpoint)
		if host == "" || configuredHosts[host] {
			continue
		}
		var registry *models.Registry
		if selectedRegistry != nil && helmRepositoryHost(selectedRegistry.URL) == host {
			registry = selectedRegistry
			selectedRegistryMatched = true
		} else if selectedCredential == nil {
			// Kept for compatibility only; there is no normal-registry fallback.
			registry = nil
		}
		credential, credentialErr := matchingHelmCredential(ctx, db, credentials, repository, endpoint, selectedCredential)
		if credentialErr != nil {
			return nil, credentialErr
		}
		if credential != nil {
			selectedRegistryMatched = selectedRegistryMatched || selectedCredential != nil
			secret, err := crypto.Decrypt(crypto.KeyFromString(config.Config.Encryption.Key), credential.EncryptedSecret)
			if err != nil {
				return nil, fmt.Errorf("decrypt Helm dependency credential for %q: %w", host, err)
			}
			if credential.Protocol == models.HelmRegistryProtocolOCI {
				ociRegistries = append(ociRegistries, helmRegistryCredential{Host: host, Username: credential.Username, Password: secret, Bearer: credential.AuthType == models.HelmRegistryAuthBearerToken})
			} else {
				httpRepositories = append(httpRepositories, helmRepositoryCredential{Name: "justscan-" + strings.ReplaceAll(host, ".", "-"), URL: endpoint, Username: credential.Username, Password: secret})
			}
			configuredHosts[host] = true
			continue
		}
		if registry == nil || registry.AuthType == "" || registry.AuthType == models.RegistryAuthNone {
			continue
		}
		if registry.AuthType == models.RegistryAuthAWSECR {
			return nil, fmt.Errorf("Helm dependency registry %q uses unsupported aws_ecr authentication", host)
		}
		secret, err := crypto.Decrypt(crypto.KeyFromString(config.Config.Encryption.Key), registry.Password)
		if err != nil {
			return nil, fmt.Errorf("decrypt Helm dependency credentials for %q: %w", host, err)
		}
		if strings.HasPrefix(endpoint, "oci://") {
			ociRegistries = append(ociRegistries, helmRegistryCredential{
				Host:     host,
				Username: registry.Username,
				Password: secret,
				Bearer:   registry.AuthType == models.RegistryAuthToken && registry.Username == "",
			})
		} else {
			if registry.AuthType == models.RegistryAuthToken {
				return nil, fmt.Errorf("Helm HTTP dependency registry %q uses unsupported bearer-token authentication", host)
			}
			httpRepositories = append(httpRepositories, helmRepositoryCredential{Name: "justscan-" + strings.ReplaceAll(host, ".", "-"), URL: endpoint, Username: helmBasicUsername(registry), Password: secret})
		}
		configuredHosts[host] = true
	}
	if (selectedRegistry != nil || selectedCredential != nil) && !selectedRegistryMatched {
		return nil, fmt.Errorf(
			"selected Helm dependency credential does not match any dependency endpoint in Chart.yaml",
		)
	}
	if len(ociRegistries) > 0 {
		if err := writeHelmRegistryCredentials(home, ociRegistries); err != nil {
			return nil, err
		}
	}
	if len(httpRepositories) > 0 {
		if err := writeHelmRepositoryCredentials(home, httpRepositories); err != nil {
			return nil, err
		}
	}
	return environment, nil
}

func helmBasicUsername(registry *models.Registry) string {
	if registry != nil && registry.Username != "" {
		return registry.Username
	}
	return "token"
}

type helmRegistryCredential struct {
	Host     string
	AuthType string // retained for compatibility with existing renderer tests
	Username string
	Password string
	Bearer   bool
}

// helmRegistryFile follows Docker's registry config format, which Helm and
// ORAS both use. A token paired with a username is an access token used as the
// Basic-auth password (the flow required by Artifactory). A token without a
// username remains a direct Bearer registry token.
type helmRegistryFile struct {
	Auths map[string]helmRegistryAuth `json:"auths"`
}

type helmRegistryAuth struct {
	Auth          string `json:"auth,omitempty"`
	RegistryToken string `json:"registrytoken,omitempty"`
}

func writeHelmRegistryCredentials(home string, registries []helmRegistryCredential) error {
	if err := os.MkdirAll(home, 0700); err != nil {
		return fmt.Errorf("create Helm registry configuration: %w", err)
	}
	configuration := helmRegistryFile{Auths: make(map[string]helmRegistryAuth, len(registries))}
	for _, registry := range registries {
		if registry.Bearer || (registry.AuthType == models.RegistryAuthToken && registry.Username == "") {
			configuration.Auths[registry.Host] = helmRegistryAuth{RegistryToken: registry.Password}
			continue
		}
		username := registry.Username
		if username == "" {
			username = "token"
		}
		configuration.Auths[registry.Host] = helmRegistryAuth{
			Auth: base64.StdEncoding.EncodeToString([]byte(username + ":" + registry.Password)),
		}
	}
	content, err := json.Marshal(configuration)
	if err != nil {
		return fmt.Errorf("encode Helm registry configuration: %w", err)
	}
	if err := os.WriteFile(filepath.Join(home, "registry.json"), content, 0600); err != nil {
		return fmt.Errorf("write Helm registry configuration: %w", err)
	}
	return nil
}

type helmRepositoryCredential struct {
	Name     string `yaml:"name"`
	URL      string `yaml:"url"`
	Username string `yaml:"username"`
	Password string `yaml:"password"`
}

type helmRepositoryFile struct {
	APIVersion   string                     `yaml:"apiVersion"`
	Generated    time.Time                  `yaml:"generated"`
	Repositories []helmRepositoryCredential `yaml:"repositories"`
}

func writeHelmRepositoryCredentials(home string, repositories []helmRepositoryCredential) error {
	if err := os.MkdirAll(home, 0700); err != nil {
		return fmt.Errorf("create Helm dependency configuration: %w", err)
	}
	content, err := yaml.Marshal(helmRepositoryFile{APIVersion: "v1", Generated: time.Now().UTC(), Repositories: repositories})
	if err != nil {
		return fmt.Errorf("encode Helm dependency configuration: %w", err)
	}
	if err := os.WriteFile(filepath.Join(home, "repositories.yaml"), content, 0600); err != nil {
		return fmt.Errorf("write Helm dependency configuration: %w", err)
	}
	return nil
}

func helmRepositoryHost(repository string) string {
	trimmed := strings.TrimPrefix(strings.TrimSpace(repository), "oci://")
	if parsed, err := url.Parse(trimmed); err == nil && parsed.Hostname() != "" {
		return parsed.Hostname()
	}
	if index := strings.Index(trimmed, "/"); index >= 0 {
		trimmed = trimmed[:index]
	}
	return strings.TrimSpace(trimmed)
}

func matchingHelmRegistry(ctx context.Context, db *bun.DB, registries []models.Registry, repository models.GitRepository, host, endpoint string) (*models.Registry, error) {
	dependencyPath := helmRepositoryPath(endpoint)
	var best *models.Registry
	bestScore := -1
	for index := range registries {
		registry := &registries[index]
		if helmRepositoryHost(registry.URL) != host {
			continue
		}
		allowed, err := registryBelongsToRepository(ctx, db, registry, repository)
		if err != nil {
			return nil, err
		}
		if allowed {
			score := helmRegistryMatchScore(dependencyPath, helmRepositoryPath(registry.URL))
			if score > bestScore {
				best = registry
				bestScore = score
			}
		}
	}
	return best, nil
}

// matchingHelmCredential resolves only the dedicated Helm credential resource.
// A tie is unsafe: the user must choose the intended credential explicitly.
func matchingHelmCredential(ctx context.Context, db *bun.DB, credentials []models.HelmRegistryCredential, repository models.GitRepository, endpoint string, selected *models.HelmRegistryCredential) (*models.HelmRegistryCredential, error) {
	protocol := models.HelmRegistryProtocolHTTP
	if strings.HasPrefix(strings.TrimSpace(endpoint), "oci://") {
		protocol = models.HelmRegistryProtocolOCI
	}
	if selected != nil {
		if selected.Protocol == protocol && helmRepositoryHost(selected.URL) == helmRepositoryHost(endpoint) && helmRegistryMatchScore(helmRepositoryPath(endpoint), helmRepositoryPath(selected.URL)) > 0 {
			return selected, nil
		}
		return nil, nil
	}
	dependencyPath, host := helmRepositoryPath(endpoint), helmRepositoryHost(endpoint)
	var best *models.HelmRegistryCredential
	bestScore := -1
	for index := range credentials {
		credential := &credentials[index]
		if credential.Protocol != protocol || helmRepositoryHost(credential.URL) != host {
			continue
		}
		allowed, err := authz.HelmRegistryCredentialBelongsToRepository(ctx, db, &repository, credential)
		if err != nil {
			return nil, err
		}
		if !allowed {
			continue
		}
		score := helmRegistryMatchScore(dependencyPath, helmRepositoryPath(credential.URL))
		if score <= 0 {
			continue
		}
		if score == bestScore {
			return nil, fmt.Errorf("multiple Helm registry credentials match %q; select one on the Helm source", endpoint)
		}
		if score > bestScore {
			best, bestScore = credential, score
		}
	}
	return best, nil
}

func helmRegistryMatchScore(dependencyPath, registryPath string) int {
	if registryPath == "" {
		return 1
	}
	if dependencyPath == registryPath || strings.HasPrefix(dependencyPath, registryPath+"/") {
		return 1000 + len(registryPath)
	}
	return 0
}

func helmRepositoryPath(repository string) string {
	trimmed := strings.TrimSpace(repository)
	if parsed, err := url.Parse(trimmed); err == nil && parsed.Hostname() != "" {
		return strings.Trim(parsed.Path, "/")
	}
	trimmed = strings.TrimPrefix(trimmed, "oci://")
	if index := strings.Index(trimmed, "/"); index >= 0 {
		return strings.Trim(trimmed[index+1:], "/")
	}
	return ""
}

func registryBelongsToRepository(ctx context.Context, db *bun.DB, registry *models.Registry, repository models.GitRepository) (bool, error) {
	if registry.OwnerType == models.OwnerTypeSystem {
		return true, nil
	}
	if repository.OwnerOrgID != nil {
		return authz.CanOrgAccessRegistry(ctx, db, *repository.OwnerOrgID, registry)
	}
	return repository.OwnerUserID != nil && registry.OwnerUserID != nil && *registry.OwnerUserID == *repository.OwnerUserID, nil
}

func renderKustomization(target string) ([]byte, error) {
	options := krusty.MakeDefaultOptions()
	// GitOps repositories routinely keep shared charts and values above an
	// environment entrypoint. The repository clone is short-lived, while plugin
	// execution remains disabled except for Kustomize's built-in Helm renderer.
	options.LoadRestrictions = types.LoadRestrictionsNone
	options.PluginConfig = types.DisabledPluginConfig()
	options.PluginConfig.HelmConfig.Enabled = true
	options.PluginConfig.HelmConfig.Command = "helm"
	resources, err := krusty.MakeKustomizer(options).Run(filesys.MakeFsOnDisk(), target)
	if err != nil {
		return nil, err
	}
	return resources.AsYaml()
}

func findKustomizationRoots(root string, entrypoints []string) ([]string, error) {
	return findKustomizationRootsWithMatcher(root, entrypoints, emptyDiscoveryPathMatcher(root))
}

func findKustomizationRootsWithMatcher(root string, entrypoints []string, discoveryMatcher discoveryPathMatcher) ([]string, error) {
	if len(entrypoints) > 0 {
		roots := make([]string, 0, len(entrypoints))
		seen := map[string]bool{}
		for _, entrypoint := range entrypoints {
			selectedPath, err := resolveRepositoryPath(root, entrypoint)
			if err != nil {
				return nil, err
			}
			if discoveryMatcher.Excluded(selectedPath) {
				return nil, fmt.Errorf("Kustomize entrypoint %q is excluded", entrypoint)
			}
			target, err := resolveKustomizationEntrypoint(root, entrypoint)
			if err != nil {
				return nil, err
			}
			if discoveryMatcher.Excluded(target) {
				return nil, fmt.Errorf("Kustomize entrypoint %q is excluded", entrypoint)
			}
			if !seen[target] {
				seen[target] = true
				roots = append(roots, target)
			}
		}
		sort.Strings(roots)
		return roots, nil
	}

	all := map[string]bool{}
	referenced := map[string]bool{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry == nil {
			return nil
		}
		if discoveryMatcher.Excluded(path) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			if entry.Name() == ".git" {
				return filepath.SkipDir
			}
			if path != root && isAutoDiscoveryFixtureDirectory(relativePath(root, path)) {
				return filepath.SkipDir
			}
			return nil
		}
		if !isKustomizationFile(entry.Name()) {
			return nil
		}
		all[filepath.Dir(path)] = true
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var document map[string]any
		if yaml.Unmarshal(content, &document) != nil {
			return nil
		}
		for _, field := range []string{"resources", "bases", "components"} {
			items, _ := document[field].([]any)
			for _, item := range items {
				reference, _ := item.(string)
				if reference == "" || strings.Contains(reference, "://") {
					continue
				}
				if child, ok := findKustomizationDirectory(filepath.Join(filepath.Dir(path), reference)); ok {
					referenced[child] = true
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	roots := make([]string, 0, len(all))
	for candidate := range all {
		if !referenced[candidate] {
			roots = append(roots, candidate)
		}
	}
	sort.Strings(roots)
	return roots, nil
}

func resolveKustomizationEntrypoint(root, entrypoint string) (string, error) {
	target := filepath.Clean(filepath.Join(root, entrypoint))
	if !pathWithin(root, target) {
		return "", fmt.Errorf("Kustomize entrypoint %q is outside the repository", entrypoint)
	}
	if info, err := os.Stat(target); err == nil && !info.IsDir() {
		target = filepath.Dir(target)
	}
	if directory, ok := findKustomizationDirectory(target); ok {
		return directory, nil
	}
	return "", fmt.Errorf("Kustomize entrypoint %q has no kustomization.yaml", entrypoint)
}

func findKustomizationDirectory(path string) (string, bool) {
	if kustomizationFilename(path) != "" {
		return filepath.Clean(path), true
	}
	return "", false
}

func kustomizationFilename(path string) string {
	for _, name := range []string{"kustomization.yaml", "kustomization.yml", "Kustomization"} {
		if info, err := os.Stat(filepath.Join(path, name)); err == nil && !info.IsDir() {
			return name
		}
	}
	return ""
}

func isKustomizationFile(name string) bool {
	return name == "kustomization.yaml" || name == "kustomization.yml" || name == "Kustomization"
}

func pathWithin(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func appendManifestImages(byRef map[string]*DiscoveredImage, content []byte, file, target string) {
	for document, raw := range strings.Split(string(content), "\n---") {
		var obj map[string]any
		if yaml.Unmarshal([]byte(raw), &obj) != nil || obj == nil {
			continue
		}
		meta, _ := obj["metadata"].(map[string]any)
		kind, _ := obj["kind"].(string)
		name, _ := meta["name"].(string)
		namespace, _ := meta["namespace"].(string)
		extractImages(obj, "", func(value, jsonPath string) {
			full, imageName, imageTag := scanner.NormalizeHelmImageRef(value)
			if full == "" {
				return
			}
			item := byRef[full]
			if item == nil {
				item = &DiscoveredImage{FullRef: full, ImageName: imageName, ImageTag: imageTag}
				byRef[full] = item
			}
			item.Locations = append(item.Locations, ImageLocation{File: file, Target: target, Document: document + 1, Kind: kind, Name: name, Namespace: namespace, Path: jsonPath})
		})
	}
}

func relativePath(root, path string) string {
	relative, err := filepath.Rel(root, path)
	if err != nil {
		return filepath.ToSlash(path)
	}
	return filepath.ToSlash(relative)
}

func sortedDiscoveredImages(byRef map[string]*DiscoveredImage) []DiscoveredImage {
	result := make([]DiscoveredImage, 0, len(byRef))
	for _, image := range byRef {
		result = append(result, *image)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].FullRef < result[j].FullRef })
	return result
}

func extractImages(value any, path string, add func(string, string)) {
	switch node := value.(type) {
	case map[string]any:
		for _, field := range []string{"containers", "initContainers", "ephemeralContainers"} {
			if items, ok := node[field].([]any); ok {
				for index, item := range items {
					if container, ok := item.(map[string]any); ok {
						if image, ok := container["image"].(string); ok {
							add(image, fmt.Sprintf("%s.%s[%d].image", path, field, index))
						}
					}
				}
			}
		}
		for key, child := range node {
			if key == "containers" || key == "initContainers" || key == "ephemeralContainers" {
				continue
			}
			childPath := key
			if path != "" {
				childPath = path + "." + key
			}
			extractImages(child, childPath, add)
		}
	case []any:
		for index, child := range node {
			extractImages(child, fmt.Sprintf("%s[%d]", path, index), add)
		}
	}
}

func uniqueTargetFiles(images []DiscoveredImage) map[string]bool {
	result := map[string]bool{}
	for _, image := range images {
		for _, location := range image.Locations {
			key := location.Target
			if key == "" {
				key = location.File
			}
			result[key] = true
		}
	}
	return result
}

// EncodeBasicCredential is kept small and testable for Git HTTP integrations.
func EncodeBasicCredential(username, secret string) string {
	return base64.StdEncoding.EncodeToString([]byte(username + ":" + secret))
}
