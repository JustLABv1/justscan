package mcpserver

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"justscan-backend/functions/audit"
	"justscan-backend/handlers/scans"
	watchlisthandlers "justscan-backend/handlers/watchlist"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/google/uuid"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/uptrace/bun"
)

type RescanScanInput struct {
	ScanID         string `json:"scan_id" jsonschema:"The authorized scan UUID to rescan."`
	Confirm        bool   `json:"confirm" jsonschema:"Must be true to start a new scan."`
	IdempotencyKey string `json:"idempotency_key" jsonschema:"Unique key for this confirmed action; retries return the original scan."`
}

type TriggerWatchlistScanInput struct {
	WatchlistID    string `json:"watchlist_id" jsonschema:"The authorized watchlist item UUID to scan."`
	Confirm        bool   `json:"confirm" jsonschema:"Must be true to start a new scan."`
	IdempotencyKey string `json:"idempotency_key" jsonschema:"Unique key for this confirmed action; retries return the original scan."`
}

type ActionOutput struct {
	Action         string `json:"action" jsonschema:"Action name."`
	ResourceID     string `json:"resource_id" jsonschema:"Source resource UUID."`
	ScanID         string `json:"scan_id" jsonschema:"Created or replayed scan UUID."`
	Status         string `json:"status" jsonschema:"Current scan status."`
	IdempotencyKey string `json:"idempotency_key" jsonschema:"Key used to make the action safe to retry."`
	Replayed       bool   `json:"replayed" jsonschema:"Whether an existing action result was returned."`
	Message        string `json:"message" jsonschema:"Action result guidance."`
}

func (s *server) handleRescanScan(ctx context.Context, _ *sdk.CallToolRequest, input RescanScanInput) (result *sdk.CallToolResult, output ActionOutput, err error) {
	started := time.Now()
	resourceID, err := parseConfirmedResource(input.ScanID, input.Confirm, input.IdempotencyKey, "scan_id")
	if err != nil {
		s.recordTool(ctx, "rescan_scan", started, err, true, false, uuid.Nil)
		return nil, output, err
	}
	output, err = s.executeAction(ctx, "rescan_scan", resourceID, input.IdempotencyKey, func() (*models.Scan, error) {
		return s.createRescan(ctx, resourceID)
	})
	s.recordTool(ctx, "rescan_scan", started, err, true, output.Replayed, resourceID)
	return nil, output, err
}

func (s *server) handleTriggerWatchlistScan(ctx context.Context, _ *sdk.CallToolRequest, input TriggerWatchlistScanInput) (result *sdk.CallToolResult, output ActionOutput, err error) {
	started := time.Now()
	resourceID, err := parseConfirmedResource(input.WatchlistID, input.Confirm, input.IdempotencyKey, "watchlist_id")
	if err != nil {
		s.recordTool(ctx, "trigger_watchlist_scan", started, err, true, false, uuid.Nil)
		return nil, output, err
	}
	output, err = s.executeAction(ctx, "trigger_watchlist_scan", resourceID, input.IdempotencyKey, func() (*models.Scan, error) {
		return s.createWatchlistScan(ctx, resourceID)
	})
	s.recordTool(ctx, "trigger_watchlist_scan", started, err, true, output.Replayed, resourceID)
	return nil, output, err
}

func parseConfirmedResource(rawID string, confirm bool, idempotencyKey, field string) (uuid.UUID, error) {
	if !confirm {
		return uuid.Nil, errors.New("confirm must be true; MCP actions never start a scan implicitly")
	}
	key := strings.TrimSpace(idempotencyKey)
	if key == "" {
		return uuid.Nil, errors.New("idempotency_key is required for scan actions")
	}
	if len(key) > 128 {
		return uuid.Nil, errors.New("idempotency_key must be 128 characters or fewer")
	}
	resourceID, err := uuid.Parse(strings.TrimSpace(rawID))
	if err != nil {
		return uuid.Nil, fmt.Errorf("%s must be a valid UUID", field)
	}
	return resourceID, nil
}

func (s *server) executeAction(ctx context.Context, action string, resourceID uuid.UUID, idempotencyKey string, create func() (*models.Scan, error)) (ActionOutput, error) {
	if err := s.requireRuntime(ctx, true); err != nil {
		return ActionOutput{}, err
	}
	record, replayed, err := s.claimAction(ctx, action, resourceID, strings.TrimSpace(idempotencyKey))
	if err != nil {
		return ActionOutput{}, err
	}
	if replayed {
		if record.ResultScanID == nil {
			return ActionOutput{}, errors.New("the requested action is already in progress; retry with the same idempotency_key later")
		}
		status := scanStatus(ctx, s.db, *record.ResultScanID)
		return ActionOutput{
			Action:         action,
			ResourceID:     resourceID.String(),
			ScanID:         record.ResultScanID.String(),
			Status:         status,
			IdempotencyKey: idempotencyKey,
			Replayed:       true,
			Message:        "Returned the scan created by the original request for this idempotency key.",
		}, nil
	}

	scan, err := create()
	if err != nil {
		_ = s.failAction(ctx, record.ID, err.Error())
		return ActionOutput{}, err
	}
	if err := s.completeAction(ctx, record.ID, scan.ID); err != nil {
		return ActionOutput{}, fmt.Errorf("record MCP action result: %w", err)
	}

	return ActionOutput{
		Action:         action,
		ResourceID:     resourceID.String(),
		ScanID:         scan.ID.String(),
		Status:         scan.Status,
		IdempotencyKey: idempotencyKey,
		Message:        "Scan started. Use get_scan or get_scan_intelligence to inspect the confirming result.",
	}, nil
}

func (s *server) claimAction(ctx context.Context, action string, resourceID uuid.UUID, idempotencyKey string) (*models.MCPActionIdempotency, bool, error) {
	record, err := s.findAction(ctx, action, idempotencyKey)
	if err == nil {
		return checkedExistingAction(record, action, resourceID)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, false, fmt.Errorf("look up MCP action key: %w", err)
	}

	now := time.Now().UTC()
	newRecord := &models.MCPActionIdempotency{
		ID:             uuid.New(),
		UserID:         s.identity.UserID,
		Action:         action,
		IdempotencyKey: idempotencyKey,
		ResourceID:     resourceID,
		Status:         "running",
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	result, err := s.db.NewInsert().Model(newRecord).On("CONFLICT DO NOTHING").Exec(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("claim MCP action key: %w", err)
	}
	rowsAffected, rowsErr := result.RowsAffected()
	if rowsErr == nil && rowsAffected == 1 {
		return newRecord, false, nil
	}

	record, err = s.findAction(ctx, action, idempotencyKey)
	if err != nil {
		return nil, false, fmt.Errorf("load concurrent MCP action: %w", err)
	}
	return checkedExistingAction(record, action, resourceID)
}

func (s *server) findAction(ctx context.Context, action, idempotencyKey string) (*models.MCPActionIdempotency, error) {
	record := &models.MCPActionIdempotency{}
	err := s.db.NewSelect().Model(record).
		Where("user_id = ?", s.identity.UserID).
		Where("action = ?", action).
		Where("idempotency_key = ?", idempotencyKey).
		Scan(ctx)
	return record, err
}

func checkedExistingAction(record *models.MCPActionIdempotency, action string, resourceID uuid.UUID) (*models.MCPActionIdempotency, bool, error) {
	if record == nil {
		return nil, false, errors.New("MCP action record is missing")
	}
	if record.Action != action || record.ResourceID != resourceID {
		return nil, false, errors.New("idempotency_key is already bound to a different MCP action or resource")
	}
	if record.Status == "failed" {
		return nil, false, errors.New("the previous MCP action attempt failed; use a new idempotency_key")
	}
	return record, true, nil
}

func (s *server) completeAction(ctx context.Context, actionID, scanID uuid.UUID) error {
	_, err := s.db.NewUpdate().Model((*models.MCPActionIdempotency)(nil)).
		Set("result_scan_id = ?", scanID).
		Set("status = ?", "completed").
		Set("error_message = ''").
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ?", actionID).
		Exec(ctx)
	return err
}

func (s *server) failAction(ctx context.Context, actionID uuid.UUID, message string) error {
	_, err := s.db.NewUpdate().Model((*models.MCPActionIdempotency)(nil)).
		Set("status = ?", "failed").
		Set("error_message = ?", message).
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ?", actionID).
		Exec(ctx)
	return err
}

func (s *server) createRescan(ctx context.Context, scanID uuid.UUID) (*models.Scan, error) {
	original := &models.Scan{}
	if err := s.db.NewSelect().Model(original).Where("id = ?", scanID).Scan(ctx); err != nil {
		return nil, errors.New("scan not found")
	}
	access := scans.ScanAccessContext{UserID: s.identity.UserID, IsAdmin: s.identity.IsAdmin, AccessibleOrgIDs: s.identity.AccessibleOrgIDs}
	if !scans.CanWriteScan(ctx, s.db, original, access) {
		return nil, errors.New("scan not found")
	}
	if original.OwnerOrgID != nil {
		org := &models.Org{}
		if err := s.db.NewSelect().Model(org).Where("id = ?", *original.OwnerOrgID).Scan(ctx); err != nil {
			return nil, errors.New("organization not found")
		}
		if !org.IsActive {
			return nil, errors.New("organization is inactive")
		}
		if !org.AllowRescans {
			return nil, errors.New("organization rescans are disabled")
		}
	}

	registry, envVars, err := scanner.ResolveRegistryForScan(ctx, s.db, original.ImageName, original.RegistryID)
	if err != nil {
		return nil, err
	}
	provider, err := scanner.ProviderForRegistry(registry)
	if err != nil {
		return nil, err
	}
	normalizedImageName, normalizedImageTag := scanner.NormalizeScanTarget(original.ImageName, original.ImageTag, registry)
	newScan := &models.Scan{
		ImageName:        normalizedImageName,
		ImageTag:         normalizedImageTag,
		Platform:         original.Platform,
		RegistryID:       original.RegistryID,
		ScanProvider:     provider,
		CurrentStep:      models.ScanStepQueued,
		HelmScanRunID:    original.HelmScanRunID,
		HelmChart:        original.HelmChart,
		HelmChartName:    original.HelmChartName,
		HelmChartVersion: original.HelmChartVersion,
		HelmSourcePath:   original.HelmSourcePath,
		Status:           models.ScanStatusPending,
		UserID:           &s.identity.UserID,
		OwnerType:        original.OwnerType,
		OwnerUserID:      original.OwnerUserID,
		OwnerOrgID:       original.OwnerOrgID,
		CreatedAt:        time.Now().UTC(),
	}
	if registry != nil {
		newScan.RegistryID = &registry.ID
	}
	if _, err := s.db.NewInsert().Model(newScan).Exec(ctx); err != nil {
		return nil, fmt.Errorf("failed to create rescan: %w", err)
	}
	if err := scans.CopyOrgScanLinks(ctx, s.db, original.ID, newScan.ID); err != nil {
		return nil, fmt.Errorf("failed to scope rescan: %w", err)
	}
	if err := scanner.DispatchScan(ctx, s.db, newScan, envVars, original.Platform); err != nil {
		if markErr := scanner.MarkScanFailed(ctx, s.db, newScan.ID, err.Error()); markErr == nil {
			completedAt := time.Now().UTC()
			newScan.Status = models.ScanStatusFailed
			newScan.CurrentStep = models.ScanStepFailed
			newScan.ErrorMessage = err.Error()
			newScan.CompletedAt = &completedAt
		}
	}
	auditMCPAction(ctx, s, "mcp.scan.rescan", original.OwnerOrgID, fmt.Sprintf("Rescan of %s:%s (original=%s, new=%s)", original.ImageName, original.ImageTag, original.ID, newScan.ID))
	return newScan, nil
}

func (s *server) createWatchlistScan(ctx context.Context, itemID uuid.UUID) (*models.Scan, error) {
	item := &models.WatchlistItem{}
	if err := s.db.NewSelect().Model(item).Where("id = ?", itemID).Scan(ctx); err != nil {
		return nil, errors.New("watchlist item not found")
	}
	if !watchlisthandlers.CanWriteWatchlistItem(ctx, s.db, item, s.identity.UserID, s.identity.IsAdmin) {
		return nil, errors.New("watchlist item not found")
	}

	scan := &models.Scan{
		ImageName:   item.ImageName,
		ImageTag:    item.ImageTag,
		RegistryID:  item.RegistryID,
		Status:      models.ScanStatusPending,
		UserID:      &s.identity.UserID,
		OwnerType:   item.OwnerType,
		OwnerUserID: item.OwnerUserID,
		OwnerOrgID:  item.OwnerOrgID,
		WatchlistID: &item.ID,
		CreatedAt:   time.Now().UTC(),
	}
	registry, envVars, err := scanner.ResolveRegistryForScan(ctx, s.db, item.ImageName, item.RegistryID)
	if err != nil {
		return nil, err
	}
	provider, err := scanner.ProviderForRegistry(registry)
	if err != nil {
		return nil, err
	}
	scan.ImageName, scan.ImageTag = scanner.NormalizeScanTarget(item.ImageName, item.ImageTag, registry)
	scan.ScanProvider = provider
	if registry != nil {
		scan.RegistryID = &registry.ID
	}
	if _, err := s.db.NewInsert().Model(scan).Exec(ctx); err != nil {
		return nil, fmt.Errorf("failed to create watchlist scan: %w", err)
	}
	if item.OwnerOrgID != nil {
		if err := scans.EnsureOrgScanLink(ctx, s.db, *item.OwnerOrgID, scan.ID); err != nil {
			return nil, fmt.Errorf("failed to scope watchlist scan: %w", err)
		}
	}
	if err := scanner.DispatchScan(ctx, s.db, scan, envVars, ""); err != nil {
		if markErr := scanner.MarkScanFailed(ctx, s.db, scan.ID, err.Error()); markErr == nil {
			completedAt := time.Now().UTC()
			scan.Status = models.ScanStatusFailed
			scan.ErrorMessage = err.Error()
			scan.CompletedAt = &completedAt
		}
	}
	now := time.Now().UTC()
	item.LastScannedAt = &now
	item.LastScanID = &scan.ID
	_, _ = s.db.NewUpdate().Model(item).Column("last_scanned_at", "last_scan_id").Where("id = ?", itemID).Exec(ctx)
	auditMCPAction(ctx, s, "mcp.watchlist.scan", item.OwnerOrgID, fmt.Sprintf("Watchlist scan for %s:%s (watchlist=%s, new=%s)", item.ImageName, item.ImageTag, item.ID, scan.ID))
	return scan, nil
}

func auditMCPAction(ctx context.Context, s *server, operation string, orgID *uuid.UUID, details string) {
	if orgID != nil {
		audit.WriteOrgAction(ctx, s.db, s.identity.UserID.String(), *orgID, operation, details)
		return
	}
	audit.Write(ctx, s.db, s.identity.UserID.String(), operation, details)
}

func scanStatus(ctx context.Context, db *bun.DB, scanID uuid.UUID) string {
	var status string
	if err := db.NewSelect().Model((*models.Scan)(nil)).Column("status").Where("id = ?", scanID).Scan(ctx, &status); err != nil {
		return "unknown"
	}
	return status
}
