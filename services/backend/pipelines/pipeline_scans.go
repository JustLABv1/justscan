package pipelines

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/crypto"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

const (
	callbackPollInterval = 2 * time.Second
	callbackHTTPTimeout  = 15 * time.Second
	maxCallbackAttempts  = 5
)

var (
	callbackWorkerCancel context.CancelFunc
	callbackWorkerWG     sync.WaitGroup
)

type CallbackConfig struct {
	URL    string `json:"url"`
	Secret string `json:"secret,omitempty"`
}

type ScanCreateConfig struct {
	Source                    string
	ExternalRef               string
	InitiatorTokenID          *uuid.UUID
	InitiatorTokenDescription string
	Callback                  CallbackConfig
}

type CallbackStatus struct {
	Status        string     `json:"status"`
	Attempts      int        `json:"attempts"`
	LastError     string     `json:"last_error,omitempty"`
	LastAttemptAt *time.Time `json:"last_attempt_at,omitempty"`
	DeliveredAt   *time.Time `json:"delivered_at,omitempty"`
}

type ScanResult struct {
	Event          string         `json:"event"`
	ScanID         string         `json:"scan_id"`
	OrgID          string         `json:"org_id"`
	Source         string         `json:"source"`
	ExternalRef    string         `json:"external_ref,omitempty"`
	Status         string         `json:"status"`
	ExternalStatus string         `json:"external_status,omitempty"`
	CurrentStep    string         `json:"current_step"`
	Verdict        string         `json:"verdict"`
	ErrorMessage   string         `json:"error_message,omitempty"`
	CriticalCount  int            `json:"critical_count"`
	HighCount      int            `json:"high_count"`
	MediumCount    int            `json:"medium_count"`
	LowCount       int            `json:"low_count"`
	UnknownCount   int            `json:"unknown_count"`
	ImageName      string         `json:"image_name"`
	ImageTag       string         `json:"image_tag"`
	ScanProvider   string         `json:"scan_provider"`
	ScanURL        string         `json:"scan_url,omitempty"`
	StatusURL      string         `json:"status_url,omitempty"`
	CompletedAt    *time.Time     `json:"completed_at,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	Callback       CallbackStatus `json:"callback"`
}

func Start(db *bun.DB) {
	if db == nil || callbackWorkerCancel != nil {
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	callbackWorkerCancel = cancel

	callbackWorkerWG.Add(1)
	go runCallbackWorker(ctx, db)
}

func Stop() {
	if callbackWorkerCancel == nil {
		return
	}
	callbackWorkerCancel()
	callbackWorkerWG.Wait()
	callbackWorkerCancel = nil
}

func NormalizeSource(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "", models.PipelineSourceGeneric:
		return models.PipelineSourceGeneric
	case models.PipelineSourceJustScanCLI:
		return models.PipelineSourceJustScanCLI
	case models.PipelineSourceGitHubActions:
		return models.PipelineSourceGitHubActions
	case models.PipelineSourceGitLabCI:
		return models.PipelineSourceGitLabCI
	case models.PipelineSourceN8N:
		return models.PipelineSourceN8N
	default:
		return ""
	}
}

func EncryptCallbackSecret(secret string) (string, error) {
	trimmed := strings.TrimSpace(secret)
	if trimmed == "" {
		return "", nil
	}
	return crypto.Encrypt(crypto.KeyFromString(config.Config.Encryption.Key), trimmed)
}

func DecryptCallbackSecret(encryptedSecret string) (string, error) {
	trimmed := strings.TrimSpace(encryptedSecret)
	if trimmed == "" {
		return "", nil
	}
	return crypto.Decrypt(crypto.KeyFromString(config.Config.Encryption.Key), trimmed)
}

func CreateScanRequest(ctx context.Context, db bun.IDB, scanID, orgID string, cfg ScanCreateConfig) error {
	parsedScanID := parseUUID(scanID)
	parsedOrgID := parseUUID(orgID)
	if parsedScanID == nil || parsedOrgID == nil {
		return fmt.Errorf("invalid scan or org id")
	}

	encryptedSecret, err := EncryptCallbackSecret(cfg.Callback.Secret)
	if err != nil {
		return err
	}

	deliveryStatus := models.PipelineCallbackStatusAwaitingTerminal
	if strings.TrimSpace(cfg.Callback.URL) == "" {
		deliveryStatus = ""
	}

	now := time.Now().UTC()
	req := &models.PipelineScanRequest{
		ScanID:                    *parsedScanID,
		OrgID:                     *parsedOrgID,
		Source:                    NormalizeSource(cfg.Source),
		InitiatorTokenID:          cfg.InitiatorTokenID,
		InitiatorTokenDescription: strings.TrimSpace(cfg.InitiatorTokenDescription),
		ExternalRef:               strings.TrimSpace(cfg.ExternalRef),
		CallbackURL:               strings.TrimSpace(cfg.Callback.URL),
		EncryptedCallbackSecret:   encryptedSecret,
		DeliveryStatus:            deliveryStatus,
		CreatedAt:                 now,
		UpdatedAt:                 now,
	}
	if req.Source == "" {
		req.Source = models.PipelineSourceGeneric
	}
	_, err = db.NewInsert().Model(req).Exec(ctx)
	return err
}

func LoadScanRequest(ctx context.Context, db bun.IDB, scanID string) (*models.PipelineScanRequest, error) {
	parsedScanID := parseUUID(scanID)
	if parsedScanID == nil {
		return nil, fmt.Errorf("invalid scan id")
	}

	req := &models.PipelineScanRequest{}
	if err := db.NewSelect().Model(req).Where("scan_id = ?", *parsedScanID).Scan(ctx); err != nil {
		return nil, err
	}
	return req, nil
}

func QueueCallbackForScan(ctx context.Context, db bun.IDB, scanID string) error {
	req, err := LoadScanRequest(ctx, db, scanID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(req.CallbackURL) == "" {
		return nil
	}

	scan := &models.Scan{}
	if err := db.NewSelect().Model(scan).Where("id = ?", req.ScanID).Scan(ctx); err != nil {
		return err
	}
	if !isTerminalScan(scan) {
		return nil
	}

	event := callbackEventForScan(scan)
	now := time.Now().UTC()
	_, err = db.NewUpdate().Model((*models.PipelineScanRequest)(nil)).
		Set("callback_event = ?", event).
		Set("delivery_status = ?", models.PipelineCallbackStatusPending).
		Set("next_attempt_at = ?", now).
		Set("updated_at = ?", now).
		Where("scan_id = ?", req.ScanID).
		Exec(ctx)
	return err
}

func BuildScanResult(ctx context.Context, db bun.IDB, req *models.PipelineScanRequest, scan *models.Scan, statusURL string) (ScanResult, error) {
	verdict := models.PipelineVerdictPending
	if req != nil && scan != nil {
		policyCount, policyResults, err := loadPolicyResults(ctx, db, req.OrgID, scan.ID)
		if err != nil {
			return ScanResult{}, err
		}
		verdict = ComputeVerdict(scan, policyCount, policyResults)
	}

	result := ScanResult{
		Event:          callbackEventForScan(scan),
		Status:         scan.Status,
		ExternalStatus: scan.ExternalStatus,
		CurrentStep:    scan.CurrentStep,
		Verdict:        verdict,
		ErrorMessage:   strings.TrimSpace(scan.ErrorMessage),
		CriticalCount:  scan.CriticalCount,
		HighCount:      scan.HighCount,
		MediumCount:    scan.MediumCount,
		LowCount:       scan.LowCount,
		UnknownCount:   scan.UnknownCount,
		ImageName:      scan.ImageName,
		ImageTag:       scan.ImageTag,
		ScanProvider:   scan.ScanProvider,
		ScanURL:        buildScanURL(scan.ID.String()),
		StatusURL:      statusURL,
		CompletedAt:    scan.CompletedAt,
		CreatedAt:      scan.CreatedAt,
	}
	if req != nil {
		result.ScanID = req.ScanID.String()
		result.OrgID = req.OrgID.String()
		result.Source = req.Source
		result.ExternalRef = req.ExternalRef
		result.Callback = CallbackStatus{
			Status:        req.DeliveryStatus,
			Attempts:      req.DeliveryAttemptCount,
			LastError:     req.LastDeliveryError,
			LastAttemptAt: req.LastAttemptAt,
			DeliveredAt:   req.DeliveredAt,
		}
	}
	return result, nil
}

// ComputeVerdict turns the completed scan and its organization policy results
// into the verdict exposed to CI. Policy rules are the only security gate.
func ComputeVerdict(scan *models.Scan, policyCount int, policyResults []models.ComplianceResult) string {
	if scan == nil {
		return models.PipelineVerdictError
	}
	if !isTerminalScan(scan) {
		return models.PipelineVerdictPending
	}

	if len(policyResults) < policyCount {
		return models.PipelineVerdictPending
	}
	for _, result := range policyResults {
		if result.Status == "fail" {
			return models.PipelineVerdictFail
		}
	}
	if scan.Status == models.ScanStatusFailed {
		return models.PipelineVerdictError
	}
	return models.PipelineVerdictPass
}

func loadPolicyResults(ctx context.Context, db bun.IDB, orgID, scanID uuid.UUID) (int, []models.ComplianceResult, error) {
	policyCount, err := db.NewSelect().Model((*models.OrgPolicy)(nil)).Where("org_id = ?", orgID).Count(ctx)
	if err != nil {
		return 0, nil, err
	}

	var results []models.ComplianceResult
	if err := db.NewSelect().
		Model(&results).
		Join("JOIN org_policies AS policy ON policy.id = compliance_result.policy_id").
		Where("compliance_result.scan_id = ?", scanID).
		Where("compliance_result.org_id = ?", orgID).
		Scan(ctx); err != nil {
		return 0, nil, err
	}
	return policyCount, results, nil
}

func runCallbackWorker(ctx context.Context, db *bun.DB) {
	defer callbackWorkerWG.Done()

	ticker := time.NewTicker(callbackPollInterval)
	defer ticker.Stop()

	for {
		if err := processPendingCallbacks(ctx, db); err != nil && ctx.Err() == nil {
			log.Warnf("pipeline callbacks: %v", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func processPendingCallbacks(ctx context.Context, db *bun.DB) error {
	var requests []models.PipelineScanRequest
	now := time.Now().UTC()
	if err := db.NewSelect().
		Model(&requests).
		Where("delivery_status = ?", models.PipelineCallbackStatusPending).
		Where("next_attempt_at IS NULL OR next_attempt_at <= ?", now).
		OrderExpr("updated_at ASC").
		Limit(20).
		Scan(ctx); err != nil {
		return err
	}

	for i := range requests {
		if err := deliverCallback(ctx, db, &requests[i]); err != nil {
			log.Warnf("pipeline callbacks: request %s failed: %v", requests[i].ID, err)
		}
	}

	return nil
}

func deliverCallback(ctx context.Context, db *bun.DB, req *models.PipelineScanRequest) error {
	if req == nil || strings.TrimSpace(req.CallbackURL) == "" {
		return nil
	}

	scan := &models.Scan{}
	if err := db.NewSelect().Model(scan).Where("id = ?", req.ScanID).Scan(ctx); err != nil {
		return markCallbackFailure(ctx, db, req, err, true)
	}
	if !isTerminalScan(scan) {
		return nil
	}

	result, err := BuildScanResult(ctx, db, req, scan, buildPipelineStatusURL(req.OrgID.String(), req.ScanID.String()))
	if err != nil {
		return markCallbackFailure(ctx, db, req, err, true)
	}
	if result.Verdict == models.PipelineVerdictPending {
		return nil
	}
	body, err := json.Marshal(result)
	if err != nil {
		return markCallbackFailure(ctx, db, req, err, true)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, req.CallbackURL, strings.NewReader(string(body)))
	if err != nil {
		return markCallbackFailure(ctx, db, req, err, true)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("User-Agent", "JustScan-Pipeline-Callback/1.0")

	if secret, err := DecryptCallbackSecret(req.EncryptedCallbackSecret); err == nil && secret != "" {
		httpReq.Header.Set("X-JustScan-Signature", signPayload(secret, body))
	} else if err != nil {
		return markCallbackFailure(ctx, db, req, err, true)
	}

	client := &http.Client{Timeout: callbackHTTPTimeout}
	resp, err := client.Do(httpReq)
	if err != nil {
		return markCallbackFailure(ctx, db, req, err, false)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return markCallbackFailure(ctx, db, req, fmt.Errorf("callback returned status %d", resp.StatusCode), false)
	}

	now := time.Now().UTC()
	_, err = db.NewUpdate().Model((*models.PipelineScanRequest)(nil)).
		Set("delivery_status = ?", models.PipelineCallbackStatusDelivered).
		Set("delivery_attempt_count = ?", req.DeliveryAttemptCount+1).
		Set("last_delivery_error = ''").
		Set("last_attempt_at = ?", now).
		Set("delivered_at = ?", now).
		Set("next_attempt_at = NULL").
		Set("updated_at = ?", now).
		Where("id = ?", req.ID).
		Exec(ctx)
	return err
}

func markCallbackFailure(ctx context.Context, db bun.IDB, req *models.PipelineScanRequest, sendErr error, terminal bool) error {
	if req == nil {
		return sendErr
	}

	attempts := req.DeliveryAttemptCount + 1
	status := models.PipelineCallbackStatusPending
	var nextAttempt interface{} = time.Now().UTC().Add(time.Duration(attempts*attempts) * time.Minute)
	if terminal || attempts >= maxCallbackAttempts {
		status = models.PipelineCallbackStatusFailed
		nextAttempt = nil
	}

	now := time.Now().UTC()
	query := db.NewUpdate().Model((*models.PipelineScanRequest)(nil)).
		Set("delivery_status = ?", status).
		Set("delivery_attempt_count = ?", attempts).
		Set("last_delivery_error = ?", truncateError(sendErr)).
		Set("last_attempt_at = ?", now).
		Set("updated_at = ?", now).
		Where("id = ?", req.ID)

	if nextAttempt == nil {
		query = query.Set("next_attempt_at = NULL")
	} else {
		query = query.Set("next_attempt_at = ?", nextAttempt)
	}

	if _, err := query.Exec(ctx); err != nil {
		return err
	}
	return sendErr
}

func signPayload(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func truncateError(err error) string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(err.Error())
	if len(message) > 1000 {
		return message[:1000]
	}
	return message
}

func isTerminalScan(scan *models.Scan) bool {
	if scan == nil {
		return false
	}
	switch scan.Status {
	case models.ScanStatusCompleted, models.ScanStatusFailed, models.ScanStatusCancelled:
		return true
	default:
		return false
	}
}

func callbackEventForScan(scan *models.Scan) string {
	if scan == nil {
		return ""
	}
	if scan.Status == models.ScanStatusCompleted {
		return "scan_completed"
	}
	return "scan_failed"
}

func buildScanURL(scanID string) string {
	baseURL := ""
	if config.Config != nil {
		for _, origin := range config.Config.AllowOrigins {
			trimmedOrigin := strings.TrimRight(strings.TrimSpace(origin), "/")
			if trimmedOrigin != "" {
				baseURL = trimmedOrigin
				break
			}
		}
	}
	if baseURL == "" || strings.TrimSpace(scanID) == "" {
		return ""
	}
	return baseURL + "/scans/" + scanID
}

func buildPipelineStatusURL(orgID, scanID string) string {
	baseURL := ""
	if config.Config != nil {
		for _, origin := range config.Config.AllowOrigins {
			trimmedOrigin := strings.TrimRight(strings.TrimSpace(origin), "/")
			if trimmedOrigin != "" {
				baseURL = trimmedOrigin
				break
			}
		}
	}
	if baseURL == "" || strings.TrimSpace(orgID) == "" || strings.TrimSpace(scanID) == "" {
		return ""
	}
	return baseURL + "/api/v1/orgs/" + orgID + "/pipeline-scans/" + scanID
}

func parseUUID(value string) *uuid.UUID {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil {
		return nil
	}
	return &parsed
}
