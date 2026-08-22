package backgroundjobs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

const (
	defaultPollInterval = 750 * time.Millisecond
	defaultLease        = 30 * time.Second
	requeueDelay        = 2 * time.Second
	defaultConcurrency  = 2
	maxListLimit        = 100
)

// ErrRequeue tells the worker that a processor completed one small
// reconciliation unit and should release its lease for another queued job.
// It is intentionally not a failure: using it prevents status mirrors from
// monopolizing the executable worker pool while an external process runs.
var ErrRequeue = errors.New("background job requeue")

// Processor performs one durable job. It should update progress after each
// bounded unit and return a SafeError when a user-facing error can be stated
// more precisely than the generic failure message.
type Processor func(context.Context, *bun.DB, *models.BackgroundJob) error

type EnqueueRequest struct {
	UserID        uuid.UUID
	ScopeType     string
	ScopeRef      string
	Type          string
	Title         string
	Description   string
	ProgressTotal int
	Phase         string
	Metadata      models.JSONObject
	Payload       models.JSONObject
	DedupeKey     string
}

// BuildDedupeKey creates a bounded, binary-safe key from logical target
// components. Length-prefixing avoids collisions when a component contains a
// separator (container image names commonly contain ':' and '/').
func BuildDedupeKey(parts ...string) string {
	hash := sha256.New()
	for _, part := range parts {
		_, _ = fmt.Fprintf(hash, "%d:", len(part))
		_, _ = hash.Write([]byte(part))
	}
	return hex.EncodeToString(hash.Sum(nil))
}

type SafeError struct {
	Public string
	Err    error
}

func (e *SafeError) Error() string {
	if e == nil {
		return "background job failed"
	}
	if e.Err != nil {
		return e.Err.Error()
	}
	return e.Public
}

func (e *SafeError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func NewSafeError(public string, err error) error {
	public = strings.TrimSpace(public)
	if public == "" {
		public = "background job failed"
	}
	return &SafeError{Public: public, Err: err}
}

var processorRegistry = struct {
	sync.RWMutex
	items   map[string]Processor
	passive map[string]struct{}
}{items: make(map[string]Processor), passive: make(map[string]struct{})}

// Register adds or replaces the processor for a job type. Registration is
// normally done during process startup before Start is called.
func Register(jobType string, processor Processor) {
	jobType = strings.TrimSpace(jobType)
	if jobType == "" || processor == nil {
		return
	}
	processorRegistry.Lock()
	processorRegistry.items[jobType] = processor
	processorRegistry.Unlock()
}

// RegisterPassive marks a job type as a durable status mirror rather than
// executable work. Passive jobs remain visible through the API but are
// reconciled by their owning subsystem, so the generic worker never claims
// them and cannot let a long-running status mirror starve deletion work.
func RegisterPassive(jobType string) {
	jobType = strings.TrimSpace(jobType)
	if jobType == "" {
		return
	}
	processorRegistry.Lock()
	processorRegistry.passive[jobType] = struct{}{}
	processorRegistry.Unlock()
}

func passiveTypes() []string {
	processorRegistry.RLock()
	defer processorRegistry.RUnlock()
	result := make([]string, 0, len(processorRegistry.passive))
	for jobType := range processorRegistry.passive {
		result = append(result, jobType)
	}
	return result
}

func processorFor(jobType string) (Processor, bool) {
	processorRegistry.RLock()
	processor, ok := processorRegistry.items[jobType]
	processorRegistry.RUnlock()
	return processor, ok
}

// Enqueue persists a job before returning. Active jobs with the same dedupe
// key are returned instead of creating duplicate work; the unique partial
// index makes this safe across concurrent API requests and instances.
func Enqueue(ctx context.Context, db *bun.DB, request EnqueueRequest) (*models.BackgroundJob, error) {
	if db == nil {
		return nil, errors.New("database is required")
	}
	if request.UserID == uuid.Nil {
		return nil, errors.New("user is required")
	}
	if strings.TrimSpace(request.Type) == "" {
		return nil, errors.New("job type is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if request.ScopeType == "" {
		request.ScopeType = models.BackgroundJobScopeUser
	}
	if request.Metadata == nil {
		request.Metadata = models.JSONObject{}
	}
	if request.Payload == nil {
		request.Payload = models.JSONObject{}
	}
	if request.ProgressTotal < 0 {
		request.ProgressTotal = 0
	}

	if request.DedupeKey != "" {
		var existing models.BackgroundJob
		err := db.NewSelect().Model(&existing).
			Where("dedupe_key = ?", request.DedupeKey).
			Where("status IN (?, ?)", models.BackgroundJobStatusQueued, models.BackgroundJobStatusRunning).
			OrderExpr("created_at ASC").Limit(1).Scan(ctx)
		if err == nil {
			return &existing, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("check active background job: %w", err)
		}
	}

	now := time.Now().UTC()
	job := &models.BackgroundJob{
		ID:            uuid.New(),
		UserID:        request.UserID,
		ScopeType:     request.ScopeType,
		ScopeRef:      request.ScopeRef,
		Type:          request.Type,
		Status:        models.BackgroundJobStatusQueued,
		Title:         request.Title,
		Description:   request.Description,
		ProgressTotal: request.ProgressTotal,
		Phase:         request.Phase,
		Metadata:      request.Metadata,
		Payload:       request.Payload,
		DedupeKey:     request.DedupeKey,
		CreatedAt:     now,
		QueuedAt:      now,
		UpdatedAt:     now,
	}
	// The API already supplies the UUID and timestamps. Suppress Bun's
	// auto-generated RETURNING clause so enqueue is a simple write and does
	// not require a result row from every database driver.
	if _, err := db.NewInsert().Model(job).Returning("").Exec(ctx); err != nil {
		if request.DedupeKey != "" && isUniqueViolation(err) {
			var existing models.BackgroundJob
			lookupErr := db.NewSelect().Model(&existing).
				Where("dedupe_key = ?", request.DedupeKey).
				Where("status IN (?, ?)", models.BackgroundJobStatusQueued, models.BackgroundJobStatusRunning).
				OrderExpr("created_at ASC").Limit(1).Scan(ctx)
			if lookupErr == nil {
				return &existing, nil
			}
		}
		return nil, fmt.Errorf("enqueue background job: %w", err)
	}
	return job, nil
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "duplicate key value violates unique constraint") ||
		strings.Contains(err.Error(), "SQLSTATE 23505")
}

// ListAuthorized returns jobs visible to the caller. Personal jobs are
// private; organization jobs are visible to members of that organization.
func ListAuthorized(ctx context.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, scope string, limit int) ([]models.BackgroundJob, error) {
	if db == nil {
		return nil, errors.New("database is required")
	}
	if limit <= 0 || limit > maxListLimit {
		limit = maxListLimit
	}
	accessibleOrgIDs, err := authz.ListAccessibleOrgIDs(ctx, db, userID, isAdmin)
	if err != nil {
		return nil, err
	}

	query := db.NewSelect().Model((*models.BackgroundJob)(nil)).OrderExpr("created_at DESC").Limit(limit)
	if !isAdmin {
		query = query.WhereGroup(" AND ", func(q *bun.SelectQuery) *bun.SelectQuery {
			q = q.Where("user_id = ?", userID)
			if len(accessibleOrgIDs) > 0 {
				q = q.WhereOr("scope_type = ? AND scope_ref IN (?)", models.BackgroundJobScopeOrg, bun.In(accessibleOrgIDs))
			}
			return q
		})
	}
	if strings.TrimSpace(scope) != "" {
		scope = strings.TrimSpace(scope)
		if scope == "personal" {
			query = query.Where("scope_type = ? AND scope_ref = ?", models.BackgroundJobScopeUser, userID.String())
		} else if orgID, parseErr := uuid.Parse(scope); parseErr == nil {
			query = query.Where("scope_type = ? AND scope_ref = ?", models.BackgroundJobScopeOrg, orgID.String())
		}
	}

	var jobs []models.BackgroundJob
	if err := query.Scan(ctx, &jobs); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return []models.BackgroundJob{}, nil
		}
		return nil, err
	}
	return jobs, nil
}

func GetAuthorized(ctx context.Context, db *bun.DB, id, userID uuid.UUID, isAdmin bool) (*models.BackgroundJob, error) {
	if db == nil {
		return nil, errors.New("database is required")
	}
	job := &models.BackgroundJob{}
	if err := db.NewSelect().Model(job).Where("id = ?", id).Scan(ctx); err != nil {
		return nil, err
	}
	if !IsAuthorized(ctx, db, job, userID, isAdmin) {
		return nil, sql.ErrNoRows
	}
	return job, nil
}

func IsAuthorized(ctx context.Context, db *bun.DB, job *models.BackgroundJob, userID uuid.UUID, isAdmin bool) bool {
	if job == nil {
		return false
	}
	if isAdmin || job.UserID == userID {
		return true
	}
	if job.ScopeType != models.BackgroundJobScopeOrg {
		return false
	}
	orgID, err := uuid.Parse(job.ScopeRef)
	if err != nil {
		return false
	}
	orgIDs, err := authz.ListAccessibleOrgIDs(ctx, db, userID, false)
	if err != nil {
		return false
	}
	for _, accessibleID := range orgIDs {
		if accessibleID == orgID {
			return true
		}
	}
	return false
}

type workerState struct {
	sync.Mutex
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

var workers workerState

// Start launches the database-backed worker pool. It is safe to call more
// than once; only one pool is active per process.
func Start(db *bun.DB) {
	if db == nil {
		return
	}
	workers.Lock()
	defer workers.Unlock()
	if workers.cancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	workers.cancel = cancel
	for index := 0; index < defaultConcurrency; index++ {
		workers.wg.Add(1)
		go runWorker(ctx, db, fmt.Sprintf("background-%s-%d", uuid.NewString(), index))
	}
	log.Infof("background job worker pool started with concurrency=%d", defaultConcurrency)
}

// Stop waits for workers to finish their current bounded unit. A running job
// is deliberately left leased; its lease expires and another process can
// reclaim it after a restart.
func Stop() {
	workers.Lock()
	cancel := workers.cancel
	workers.Unlock()
	if cancel == nil {
		return
	}
	cancel()
	workers.wg.Wait()
	workers.Lock()
	workers.cancel = nil
	workers.Unlock()
}

func runWorker(ctx context.Context, db *bun.DB, workerID string) {
	defer workers.wg.Done()
	ticker := time.NewTicker(defaultPollInterval)
	defer ticker.Stop()
	for {
		job, claimed, err := claim(ctx, db, workerID)
		if err != nil && ctx.Err() == nil {
			log.Warnf("background job worker %s claim failed: %v", workerID, err)
		}
		if claimed {
			process(ctx, db, job)
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func claim(ctx context.Context, db *bun.DB, workerID string) (*models.BackgroundJob, bool, error) {
	if ctx.Err() != nil {
		return nil, false, ctx.Err()
	}
	var claimed *models.BackgroundJob
	err := db.RunInTx(ctx, nil, func(txCtx context.Context, tx bun.Tx) error {
		var candidates []models.BackgroundJob
		query := tx.NewSelect().Model(&candidates).
			Where("(status = ? AND (lease_until IS NULL OR lease_until <= now())) OR (status = ? AND (lease_until IS NULL OR lease_until < now()))", models.BackgroundJobStatusQueued, models.BackgroundJobStatusRunning).
			OrderExpr("CASE WHEN status = 'queued' THEN 0 ELSE 1 END, created_at ASC").Limit(1).For("UPDATE SKIP LOCKED")
		passive := passiveTypes()
		if len(passive) > 0 {
			query = query.Where("type NOT IN (?)", bun.In(passive))
		}
		err := query.Scan(txCtx)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if len(candidates) == 0 {
			return nil
		}
		candidate := candidates[0]
		now := time.Now().UTC()
		result, err := tx.NewUpdate().Model((*models.BackgroundJob)(nil)).
			Set("status = ?", models.BackgroundJobStatusRunning).
			Set("started_at = COALESCE(started_at, ?)", now).
			Set("phase = CASE WHEN phase = '' THEN 'starting' ELSE phase END").
			Set("lease_owner = ?", workerID).
			Set("lease_until = ?", now.Add(defaultLease)).
			Set("updated_at = ?", now).
			Where("id = ?", candidate.ID).
			Where("(status = ? AND (lease_until IS NULL OR lease_until <= now())) OR (status = ? AND (lease_until IS NULL OR lease_until < now()))", models.BackgroundJobStatusQueued, models.BackgroundJobStatusRunning).
			Exec(txCtx)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return nil
		}
		candidate.Status = models.BackgroundJobStatusRunning
		candidate.StartedAt = &now
		candidate.Phase = firstNonEmpty(candidate.Phase, "starting")
		candidate.LeaseOwner = workerID
		leaseUntil := now.Add(defaultLease)
		candidate.LeaseUntil = &leaseUntil
		claimed = &candidate
		return nil
	})
	return claimed, claimed != nil, err
}

func process(ctx context.Context, db *bun.DB, job *models.BackgroundJob) {
	processor, ok := processorFor(job.Type)
	if !ok {
		markFailed(context.Background(), db, job, fmt.Errorf("no processor registered for job type %q", job.Type))
		return
	}

	jobCtx, cancel := context.WithCancel(ctx)
	leaseLost := make(chan struct{}, 1)
	heartbeatDone := make(chan struct{})
	go leaseHeartbeat(jobCtx, db, job, cancel, leaseLost, heartbeatDone)
	err := processor(jobCtx, db, job)
	cancel()
	<-heartbeatDone
	select {
	case <-leaseLost:
		log.WithField("job_id", job.ID).Warn("background job lease was lost; leaving job recoverable")
		return
	default:
	}
	if err != nil {
		if ctx.Err() != nil {
			return
		}
		if errors.Is(err, ErrRequeue) {
			if requeueErr := requeue(context.Background(), db, job); requeueErr != nil {
				log.WithError(requeueErr).WithField("job_id", job.ID).Error("background job requeue update failed")
			}
			return
		}
		markFailed(context.Background(), db, job, err)
		return
	}
	if err := markSucceeded(context.Background(), db, job); err != nil {
		log.WithError(err).WithField("job_id", job.ID).Error("background job completion update failed")
	}
}

func requeue(ctx context.Context, db *bun.DB, job *models.BackgroundJob) error {
	query := db.NewUpdate().Model((*models.BackgroundJob)(nil)).
		Set("lease_owner = ''").
		Set("lease_until = ?", time.Now().UTC().Add(requeueDelay)).
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ?", job.ID).
		Where("status = ?", models.BackgroundJobStatusRunning)
	if job.LeaseOwner != "" {
		query = query.Where("lease_owner = ?", job.LeaseOwner)
	}
	result, err := query.Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return errors.New("background job lease is no longer owned")
	}
	return nil
}

func leaseHeartbeat(ctx context.Context, db *bun.DB, job *models.BackgroundJob, cancel context.CancelFunc, leaseLost chan<- struct{}, done chan<- struct{}) {
	defer close(done)
	ticker := time.NewTicker(defaultLease / 3)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			rows, err := renewLease(ctx, db, job)
			if err != nil {
				log.WithError(err).WithField("job_id", job.ID).Warn("background job lease heartbeat failed")
				continue
			}
			if rows == 0 {
				select {
				case leaseLost <- struct{}{}:
				default:
				}
				cancel()
				return
			}
		}
	}
}

func renewLease(ctx context.Context, db *bun.DB, job *models.BackgroundJob) (int64, error) {
	result, err := db.NewUpdate().Model((*models.BackgroundJob)(nil)).
		Set("lease_until = ?", time.Now().UTC().Add(defaultLease)).
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ?", job.ID).
		Where("status = ?", models.BackgroundJobStatusRunning).
		Where("lease_owner = ?", job.LeaseOwner).
		Exec(ctx)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func markSucceeded(ctx context.Context, db *bun.DB, job *models.BackgroundJob) error {
	now := time.Now().UTC()
	query := db.NewUpdate().Model((*models.BackgroundJob)(nil)).
		Set("status = ?", models.BackgroundJobStatusSucceeded).
		Set("progress_current = CASE WHEN progress_total > 0 THEN progress_total ELSE progress_current END").
		Set("phase = ?", "completed").
		Set("error_message = ''").
		Set("finished_at = ?", now).
		Set("lease_owner = ''").
		Set("lease_until = NULL").
		Set("updated_at = ?", now).
		Where("id = ?", job.ID).
		Where("status = ?", models.BackgroundJobStatusRunning)
	if job.LeaseOwner != "" {
		query = query.Where("lease_owner = ?", job.LeaseOwner)
	}
	_, err := query.Exec(ctx)
	return err
}

func markFailed(ctx context.Context, db *bun.DB, job *models.BackgroundJob, err error) {
	if err == nil {
		err = errors.New("background job failed")
	}
	public := "Background job failed"
	var safeErr *SafeError
	if errors.As(err, &safeErr) && strings.TrimSpace(safeErr.Public) != "" {
		public = safeErr.Public
	}
	log.WithError(err).WithFields(log.Fields{"job_id": job.ID, "job_type": job.Type}).Error("background job failed")
	now := time.Now().UTC()
	query := db.NewUpdate().Model((*models.BackgroundJob)(nil)).
		Set("status = ?", models.BackgroundJobStatusFailed).
		Set("error_message = ?", public).
		Set("error_log = ?", err.Error()).
		Set("finished_at = ?", now).
		Set("lease_owner = ''").
		Set("lease_until = NULL").
		Set("updated_at = ?", now).
		Where("id = ?", job.ID).
		Where("status = ?", models.BackgroundJobStatusRunning)
	if job.LeaseOwner != "" {
		query = query.Where("lease_owner = ?", job.LeaseOwner)
	}
	if _, updateErr := query.Exec(ctx); updateErr != nil {
		log.WithError(updateErr).WithField("job_id", job.ID).Error("background job failure update failed")
	}
}

func UpdateProgress(ctx context.Context, db *bun.DB, jobID uuid.UUID, leaseOwner string, current, total int, phase string, payload models.JSONObject) error {
	if db == nil {
		return errors.New("database is required")
	}
	if current < 0 {
		current = 0
	}
	if total < 0 {
		total = 0
	}
	if total > 0 && current > total {
		current = total
	}
	now := time.Now().UTC()
	query := db.NewUpdate().Model((*models.BackgroundJob)(nil)).
		Set("progress_current = ?", current).
		Set("progress_total = ?", total).
		Set("phase = ?", phase).
		Set("updated_at = ?", now).
		Set("lease_until = ?", now.Add(defaultLease)).
		Where("id = ?", jobID).
		Where("status = ?", models.BackgroundJobStatusRunning)
	if leaseOwner != "" {
		query = query.Where("lease_owner = ?", leaseOwner)
	}
	if payload != nil {
		query = query.Set("payload = ?", payload)
	}
	result, err := query.Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return errors.New("background job lease is no longer owned")
	}
	return nil
}

func firstNonEmpty(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}
