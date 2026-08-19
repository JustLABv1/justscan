package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"justscan-backend/compliance"
	"justscan-backend/functions/authz"
	scanhandlers "justscan-backend/handlers/scans"
	watchlisthandlers "justscan-backend/handlers/watchlist"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/uptrace/bun"
)

func addExtendedTools(server *sdk.Server, service *server) {
	readOnly := true
	closedWorld := false
	sdk.AddTool(server, &sdk.Tool{
		Name: "list_watchlists", Description: "List authorized watchlists with their latest scan and CVE Intelligence impact.",
		Annotations: &sdk.ToolAnnotations{ReadOnlyHint: readOnly, OpenWorldHint: &closedWorld},
	}, service.handleListWatchlists)
	sdk.AddTool(server, &sdk.Tool{
		Name: "get_watchlist", Description: "Get one authorized watchlist, its latest scan, compliance posture, and CVE Intelligence impact.",
		Annotations: &sdk.ToolAnnotations{ReadOnlyHint: readOnly, OpenWorldHint: &closedWorld},
	}, service.handleGetWatchlist)
	sdk.AddTool(server, &sdk.Tool{
		Name: "get_scan_intelligence", Description: "Get changed CVE findings, confirmation requirements, and visible policy impact for an authorized scan.",
		Annotations: &sdk.ToolAnnotations{ReadOnlyHint: readOnly, OpenWorldHint: &closedWorld},
	}, service.handleGetScanIntelligence)
	sdk.AddTool(server, &sdk.Tool{
		Name: "list_intelligence_impacts", Description: "List scans whose CVE Intelligence changed after the original scan, optionally scoped to a watchlist or image.",
		Annotations: &sdk.ToolAnnotations{ReadOnlyHint: readOnly, OpenWorldHint: &closedWorld},
	}, service.handleListIntelligenceImpacts)

	destructive := false
	actionAnnotations := &sdk.ToolAnnotations{DestructiveHint: &destructive, IdempotentHint: true, ReadOnlyHint: false, OpenWorldHint: &closedWorld}
	sdk.AddTool(server, &sdk.Tool{
		Name: "rescan_scan", Description: "Start a confirming rescan for an authorized scan. Requires confirm=true and a unique idempotency_key.",
		Annotations: actionAnnotations,
	}, service.handleRescanScan)
	sdk.AddTool(server, &sdk.Tool{
		Name: "trigger_watchlist_scan", Description: "Start an on-demand scan for an authorized watchlist item. Requires confirm=true and a unique idempotency_key.",
		Annotations: actionAnnotations,
	}, service.handleTriggerWatchlistScan)
}

type ListWatchlistsInput struct {
	Image   string `json:"image,omitempty" jsonschema:"Filter by a partial image name."`
	Enabled *bool  `json:"enabled,omitempty" jsonschema:"Filter by whether the watchlist is enabled."`
	Page    int    `json:"page,omitempty" jsonschema:"One-based result page. Defaults to 1."`
	Limit   int    `json:"limit,omitempty" jsonschema:"Number of results. Defaults to 20 and is capped by the server."`
}

type ListWatchlistsOutput struct {
	Watchlists []WatchlistSummary `json:"watchlists" jsonschema:"Authorized watchlist summaries."`
	Total      int                `json:"total" jsonschema:"Total number of matching watchlists."`
	Page       int                `json:"page" jsonschema:"One-based result page."`
	Limit      int                `json:"limit" jsonschema:"Number of results returned per page."`
}

type GetWatchlistInput struct {
	WatchlistID string `json:"watchlist_id" jsonschema:"The JustScan watchlist item UUID."`
}

type GetWatchlistOutput struct {
	Watchlist WatchlistSummary `json:"watchlist" jsonschema:"Authorized watchlist details."`
}

type WatchlistSummary struct {
	ID            string                     `json:"id" jsonschema:"Watchlist UUID."`
	ImageName     string                     `json:"image_name" jsonschema:"Container image repository/name."`
	ImageTag      string                     `json:"image_tag" jsonschema:"Container image tag."`
	Schedule      string                     `json:"schedule" jsonschema:"Configured cron schedule."`
	Timezone      string                     `json:"timezone" jsonschema:"Schedule timezone."`
	Enabled       bool                       `json:"enabled" jsonschema:"Whether scheduled scans are enabled."`
	LastScannedAt string                     `json:"last_scanned_at,omitempty" jsonschema:"Last scan trigger time in RFC3339 format."`
	LastScan      *ScanSummary               `json:"last_scan,omitempty" jsonschema:"Latest scan summary."`
	Intelligence  *IntelligenceImpact        `json:"intelligence,omitempty" jsonschema:"CVE Intelligence impact on the latest scan."`
	Compliance    *WatchlistComplianceStatus `json:"compliance,omitempty" jsonschema:"Visible compliance posture on the latest scan."`
}

type WatchlistComplianceStatus struct {
	Status            string   `json:"status" jsonschema:"pass or fail."`
	PassCount         int      `json:"pass_count" jsonschema:"Passing policy result count."`
	FailCount         int      `json:"fail_count" jsonschema:"Failing policy result count."`
	PolicyNames       []string `json:"policy_names" jsonschema:"Visible policy names."`
	FailedPolicyNames []string `json:"failed_policy_names" jsonschema:"Visible failed policy names."`
	OrgNames          []string `json:"org_names" jsonschema:"Visible organization names."`
	EvaluatedAt       string   `json:"evaluated_at,omitempty" jsonschema:"Latest policy evaluation time in RFC3339 format."`
}

type GetScanIntelligenceInput struct {
	ScanID string `json:"scan_id" jsonschema:"The JustScan scan UUID."`
}

type GetScanIntelligenceOutput struct {
	ScanID          string                `json:"scan_id" jsonschema:"Authorized scan UUID."`
	Summary         *IntelligenceImpact   `json:"summary,omitempty" jsonschema:"Aggregate CVE Intelligence impact."`
	ChangedFindings []ChangedFinding      `json:"changed_findings" jsonschema:"Findings whose intelligence changed after the scan."`
	PolicyImpacts   []PolicyImpactSummary `json:"policy_impacts" jsonschema:"Visible policy impacts derived from current intelligence."`
	RescanRequired  bool                  `json:"rescan_required" jsonschema:"Whether a confirming rescan is required."`
}

type ChangedFinding struct {
	FindingID        string   `json:"finding_id" jsonschema:"Historical vulnerability finding UUID."`
	CVE              string   `json:"cve" jsonschema:"CVE or provider vulnerability identifier."`
	Package          string   `json:"package" jsonschema:"Affected package name."`
	InstalledVersion string   `json:"installed_version" jsonschema:"Installed package version."`
	FixedVersion     string   `json:"fixed_version,omitempty" jsonschema:"Known fixed version from the original or current intelligence."`
	Severity         string   `json:"severity" jsonschema:"Current intelligence severity."`
	PostureState     string   `json:"posture_state" jsonschema:"Current derived posture state."`
	CVEState         string   `json:"cve_state" jsonschema:"Current CVE state."`
	Reason           string   `json:"reason,omitempty" jsonschema:"Reason for the current posture."`
	ConflictSources  []string `json:"conflict_sources,omitempty" jsonschema:"Intelligence sources that disagree."`
	FixedVersions    []string `json:"fixed_versions,omitempty" jsonschema:"Current intelligence fixed versions."`
	ObservedAt       string   `json:"observed_at,omitempty" jsonschema:"When the current posture was observed."`
}

type PolicyImpactSummary struct {
	PolicyName          string   `json:"policy_name" jsonschema:"Policy name."`
	HistoricalStatus    string   `json:"historical_status" jsonschema:"Original stored policy result."`
	CurrentStatus       string   `json:"current_status" jsonschema:"Policy result under current intelligence."`
	Impact              string   `json:"impact" jsonschema:"Resolved, new_failure, still_failed, or needs_validation."`
	ChangedCVEs         []string `json:"changed_cves" jsonschema:"CVEs contributing to the policy impact."`
	ChangedFindingCount int      `json:"changed_finding_count" jsonschema:"Changed finding count."`
	Reason              string   `json:"reason,omitempty" jsonschema:"Human-readable policy impact reason."`
}

type ListIntelligenceImpactsInput struct {
	State       string `json:"state,omitempty" jsonschema:"Impact filter: changed, confirmation_pending, needs_rescan, or fix_available. Defaults to changed."`
	Image       string `json:"image,omitempty" jsonschema:"Filter by a partial image name."`
	WatchlistID string `json:"watchlist_id,omitempty" jsonschema:"Restrict results to the latest scan for one authorized watchlist."`
	Page        int    `json:"page,omitempty" jsonschema:"One-based result page. Defaults to 1."`
	Limit       int    `json:"limit,omitempty" jsonschema:"Number of results. Defaults to 20 and is capped by the server."`
}

type ListIntelligenceImpactsOutput struct {
	Impacts []IntelligenceImpactRecord `json:"impacts" jsonschema:"Authorized scans with CVE Intelligence impact."`
	Total   int                        `json:"total" jsonschema:"Total number of matching scans."`
	Page    int                        `json:"page" jsonschema:"One-based result page."`
	Limit   int                        `json:"limit" jsonschema:"Number of results returned per page."`
}

type IntelligenceImpactRecord struct {
	Scan           ScanSummary          `json:"scan" jsonschema:"Scan carrying the intelligence impact."`
	Watchlists     []WatchlistReference `json:"watchlists,omitempty" jsonschema:"Authorized watchlists pointing to this scan."`
	RescanRequired bool                 `json:"rescan_required" jsonschema:"Whether the impact requires confirmation."`
}

type WatchlistReference struct {
	ID        string `json:"id" jsonschema:"Watchlist UUID."`
	ImageName string `json:"image_name" jsonschema:"Watchlist image name."`
	ImageTag  string `json:"image_tag" jsonschema:"Watchlist image tag."`
}

func (s *server) handleListWatchlists(ctx context.Context, _ *sdk.CallToolRequest, input ListWatchlistsInput) (result *sdk.CallToolResult, output ListWatchlistsOutput, err error) {
	started := time.Now()
	defer func() { s.recordTool(ctx, "list_watchlists", started, err, false, false, uuid.Nil) }()
	if err = s.requireRuntime(ctx, false); err != nil {
		return nil, output, err
	}
	output, err = s.listWatchlists(ctx, input)
	return nil, output, err
}

func (s *server) handleGetWatchlist(ctx context.Context, _ *sdk.CallToolRequest, input GetWatchlistInput) (result *sdk.CallToolResult, output GetWatchlistOutput, err error) {
	started := time.Now()
	defer func() { s.recordTool(ctx, "get_watchlist", started, err, false, false, uuid.Nil) }()
	if err = s.requireRuntime(ctx, false); err != nil {
		return nil, output, err
	}
	output, err = s.getWatchlist(ctx, input)
	return nil, output, err
}

func (s *server) handleGetScanIntelligence(ctx context.Context, _ *sdk.CallToolRequest, input GetScanIntelligenceInput) (result *sdk.CallToolResult, output GetScanIntelligenceOutput, err error) {
	started := time.Now()
	defer func() { s.recordTool(ctx, "get_scan_intelligence", started, err, false, false, uuid.Nil) }()
	if err = s.requireRuntime(ctx, false); err != nil {
		return nil, output, err
	}
	output, err = s.getScanIntelligence(ctx, input)
	return nil, output, err
}

func (s *server) handleListIntelligenceImpacts(ctx context.Context, _ *sdk.CallToolRequest, input ListIntelligenceImpactsInput) (result *sdk.CallToolResult, output ListIntelligenceImpactsOutput, err error) {
	started := time.Now()
	defer func() { s.recordTool(ctx, "list_intelligence_impacts", started, err, false, false, uuid.Nil) }()
	if err = s.requireRuntime(ctx, false); err != nil {
		return nil, output, err
	}
	output, err = s.listIntelligenceImpacts(ctx, input)
	return nil, output, err
}

func (s *server) listWatchlists(ctx context.Context, input ListWatchlistsInput) (ListWatchlistsOutput, error) {
	page, limit := normalizePage(input.Page, input.Limit, s.maxPageSize)
	buildQuery := func(target *[]models.WatchlistItem) *bun.SelectQuery {
		q := s.db.NewSelect().Model(target)
		q = authz.ApplyOwnershipVisibility(q, "", "user_id", "owner_user_id", "owner_org_id", "org_watchlist_items", "watchlist_item_id", s.identity.UserID, s.identity.IsAdmin, s.identity.AccessibleOrgIDs)
		if image := strings.TrimSpace(input.Image); image != "" {
			q = q.Where("image_name ILIKE ?", "%"+image+"%")
		}
		if input.Enabled != nil {
			q = q.Where("enabled = ?", *input.Enabled)
		}
		return q
	}

	var countTarget []models.WatchlistItem
	total, err := buildQuery(&countTarget).Count(ctx)
	if err != nil {
		return ListWatchlistsOutput{}, fmt.Errorf("count watchlists: %w", err)
	}
	items := make([]models.WatchlistItem, 0, limit)
	if err := buildQuery(&items).OrderExpr("created_at DESC").Limit(limit).Offset((page - 1) * limit).Scan(ctx); err != nil {
		return ListWatchlistsOutput{}, fmt.Errorf("list watchlists: %w", err)
	}
	if err := watchlisthandlers.AttachWatchlistPosture(ctx, s.db, items, s.identity.IsAdmin, s.identity.AccessibleOrgIDs); err != nil {
		return ListWatchlistsOutput{}, fmt.Errorf("load watchlist posture: %w", err)
	}

	result := make([]WatchlistSummary, 0, len(items))
	for _, item := range items {
		result = append(result, summarizeWatchlist(item))
	}
	return ListWatchlistsOutput{Watchlists: result, Total: total, Page: page, Limit: limit}, nil
}

func (s *server) getWatchlist(ctx context.Context, input GetWatchlistInput) (GetWatchlistOutput, error) {
	itemID, err := uuid.Parse(strings.TrimSpace(input.WatchlistID))
	if err != nil {
		return GetWatchlistOutput{}, errors.New("watchlist_id must be a valid UUID")
	}
	items := make([]models.WatchlistItem, 0, 1)
	q := s.db.NewSelect().Model(&items).Where("id = ?", itemID)
	q = authz.ApplyOwnershipVisibility(q, "", "user_id", "owner_user_id", "owner_org_id", "org_watchlist_items", "watchlist_item_id", s.identity.UserID, s.identity.IsAdmin, s.identity.AccessibleOrgIDs)
	if err := q.Scan(ctx); err != nil || len(items) == 0 {
		return GetWatchlistOutput{}, errors.New("watchlist item not found")
	}
	if err := watchlisthandlers.AttachWatchlistPosture(ctx, s.db, items, s.identity.IsAdmin, s.identity.AccessibleOrgIDs); err != nil {
		return GetWatchlistOutput{}, fmt.Errorf("load watchlist posture: %w", err)
	}
	return GetWatchlistOutput{Watchlist: summarizeWatchlist(items[0])}, nil
}

func summarizeWatchlist(item models.WatchlistItem) WatchlistSummary {
	result := WatchlistSummary{
		ID:            item.ID.String(),
		ImageName:     item.ImageName,
		ImageTag:      item.ImageTag,
		Schedule:      item.Schedule,
		Timezone:      item.Timezone,
		Enabled:       item.Enabled,
		LastScannedAt: formatOptionalTime(item.LastScannedAt),
		Intelligence:  summarizeIntelligence(item.IntelligenceSummary),
	}
	if item.LastScan != nil {
		result.LastScan = scanSummaryFromModel(*item.LastScan, item.IntelligenceSummary)
	}
	if item.ComplianceSummary != nil {
		result.Compliance = &WatchlistComplianceStatus{
			Status:            item.ComplianceSummary.Status,
			PassCount:         item.ComplianceSummary.PassCount,
			FailCount:         item.ComplianceSummary.FailCount,
			PolicyNames:       append([]string{}, item.ComplianceSummary.PolicyNames...),
			FailedPolicyNames: append([]string{}, item.ComplianceSummary.FailedPolicyNames...),
			OrgNames:          append([]string{}, item.ComplianceSummary.OrgNames...),
			EvaluatedAt:       formatOptionalTime(item.ComplianceSummary.EvaluatedAt),
		}
	}
	return result
}

func (s *server) getScanIntelligence(ctx context.Context, input GetScanIntelligenceInput) (GetScanIntelligenceOutput, error) {
	scanID, err := uuid.Parse(strings.TrimSpace(input.ScanID))
	if err != nil {
		return GetScanIntelligenceOutput{}, errors.New("scan_id must be a valid UUID")
	}
	scan, err := s.loadAuthorizedScan(ctx, scanID)
	if err != nil {
		return GetScanIntelligenceOutput{}, err
	}
	summaries, err := loadIntelligence(ctx, s.db, []models.Scan{*scan})
	if err != nil {
		return GetScanIntelligenceOutput{}, err
	}
	changedFindings, err := loadChangedFindings(ctx, s.db, scan)
	if err != nil {
		return GetScanIntelligenceOutput{}, fmt.Errorf("load changed CVE findings: %w", err)
	}
	visibleOrgIDs, err := compliance.LoadVisibleOrgIDs(ctx, s.db, s.identity.UserID, s.identity.IsAdmin)
	if err != nil {
		return GetScanIntelligenceOutput{}, fmt.Errorf("resolve policy visibility: %w", err)
	}
	policyResponse, err := compliance.EvaluateScanIntelligencePolicyImpacts(ctx, s.db, scan.ID, visibleOrgIDs, s.identity.IsAdmin)
	if err != nil {
		return GetScanIntelligenceOutput{}, fmt.Errorf("evaluate policy impact: %w", err)
	}
	policyImpacts := make([]PolicyImpactSummary, 0, len(policyResponse.Policies))
	for _, policy := range policyResponse.Policies {
		policyImpacts = append(policyImpacts, PolicyImpactSummary{
			PolicyName:          policy.PolicyName,
			HistoricalStatus:    policy.HistoricalStatus,
			CurrentStatus:       policy.CurrentStatus,
			Impact:              policy.Impact,
			ChangedCVEs:         append([]string{}, policy.ChangedCVEs...),
			ChangedFindingCount: policy.ChangedFindingCount,
			Reason:              policy.Reason,
		})
	}

	summary := summarizeIntelligence(summaries[scan.ID])
	rescanRequired := policyResponse.RescanRequired
	if summary != nil && summary.NeedsValidationCount > 0 {
		rescanRequired = true
	}
	return GetScanIntelligenceOutput{
		ScanID:          scan.ID.String(),
		Summary:         summary,
		ChangedFindings: changedFindings,
		PolicyImpacts:   policyImpacts,
		RescanRequired:  rescanRequired,
	}, nil
}

func (s *server) listIntelligenceImpacts(ctx context.Context, input ListIntelligenceImpactsInput) (ListIntelligenceImpactsOutput, error) {
	state := strings.ToLower(strings.TrimSpace(input.State))
	if state == "" {
		state = "changed"
	}
	if _, _, supported := intelligenceFilterCondition("scan.id", state); !supported {
		return ListIntelligenceImpactsOutput{}, errors.New("unsupported intelligence state; use changed, confirmation_pending, needs_rescan, or fix_available")
	}
	page, limit := normalizePage(input.Page, input.Limit, s.maxPageSize)

	if strings.TrimSpace(input.WatchlistID) != "" {
		watchlist, err := s.getWatchlist(ctx, GetWatchlistInput{WatchlistID: input.WatchlistID})
		if err != nil {
			return ListIntelligenceImpactsOutput{}, err
		}
		if watchlist.Watchlist.LastScan == nil || !impactMatches(watchlist.Watchlist.Intelligence, state) {
			return ListIntelligenceImpactsOutput{Impacts: []IntelligenceImpactRecord{}, Total: 0, Page: page, Limit: limit}, nil
		}
		return ListIntelligenceImpactsOutput{
			Impacts: []IntelligenceImpactRecord{{
				Scan:           *watchlist.Watchlist.LastScan,
				Watchlists:     []WatchlistReference{{ID: watchlist.Watchlist.ID, ImageName: watchlist.Watchlist.ImageName, ImageTag: watchlist.Watchlist.ImageTag}},
				RescanRequired: watchlist.Watchlist.Intelligence != nil && watchlist.Watchlist.Intelligence.NeedsValidationCount > 0,
			}},
			Total: 1,
			Page:  page,
			Limit: limit,
		}, nil
	}

	list, err := s.listScans(ctx, ListScansInput{Image: input.Image, Intelligence: state, Page: page, Limit: limit})
	if err != nil {
		return ListIntelligenceImpactsOutput{}, err
	}
	if len(list.Scans) == 0 {
		return ListIntelligenceImpactsOutput{Impacts: []IntelligenceImpactRecord{}, Total: list.Total, Page: page, Limit: limit}, nil
	}

	scanIDs := make([]uuid.UUID, 0, len(list.Scans))
	for _, scan := range list.Scans {
		if scanID, parseErr := uuid.Parse(scan.ID); parseErr == nil {
			scanIDs = append(scanIDs, scanID)
		}
	}
	watchlistsByScan, err := s.watchlistsByScan(ctx, scanIDs)
	if err != nil {
		return ListIntelligenceImpactsOutput{}, err
	}
	impacts := make([]IntelligenceImpactRecord, 0, len(list.Scans))
	for _, scan := range list.Scans {
		impact := IntelligenceImpactRecord{Scan: scan, Watchlists: watchlistsByScan[scan.ID]}
		impact.RescanRequired = scan.Intelligence != nil && scan.Intelligence.NeedsValidationCount > 0
		impacts = append(impacts, impact)
	}
	return ListIntelligenceImpactsOutput{Impacts: impacts, Total: list.Total, Page: page, Limit: limit}, nil
}

func (s *server) loadAuthorizedScan(ctx context.Context, scanID uuid.UUID) (*models.Scan, error) {
	scan := &models.Scan{}
	if err := s.db.NewSelect().Model(scan).Where("id = ?", scanID).Scan(ctx); err != nil {
		return nil, errors.New("scan not found")
	}
	if !scanhandlers.CanReadScan(ctx, s.db, scan, scanhandlers.ScanAccessContext{
		UserID:           s.identity.UserID,
		IsAdmin:          s.identity.IsAdmin,
		AccessibleOrgIDs: s.identity.AccessibleOrgIDs,
	}) {
		return nil, errors.New("scan not found")
	}
	return scan, nil
}

func (s *server) watchlistsByScan(ctx context.Context, scanIDs []uuid.UUID) (map[string][]WatchlistReference, error) {
	result := make(map[string][]WatchlistReference)
	if len(scanIDs) == 0 {
		return result, nil
	}
	var items []models.WatchlistItem
	q := s.db.NewSelect().Model(&items).Where("last_scan_id IN (?)", bun.In(scanIDs))
	q = authz.ApplyOwnershipVisibility(q, "", "user_id", "owner_user_id", "owner_org_id", "org_watchlist_items", "watchlist_item_id", s.identity.UserID, s.identity.IsAdmin, s.identity.AccessibleOrgIDs)
	if err := q.Scan(ctx); err != nil {
		return nil, fmt.Errorf("load impacted watchlists: %w", err)
	}
	for _, item := range items {
		if item.LastScanID == nil {
			continue
		}
		result[item.LastScanID.String()] = append(result[item.LastScanID.String()], WatchlistReference{ID: item.ID.String(), ImageName: item.ImageName, ImageTag: item.ImageTag})
	}
	for scanID := range result {
		sort.Slice(result[scanID], func(i, j int) bool { return result[scanID][i].ID < result[scanID][j].ID })
	}
	return result, nil
}

func loadChangedFindings(ctx context.Context, db *bun.DB, scan *models.Scan) ([]ChangedFinding, error) {
	if scan == nil {
		return []ChangedFinding{}, nil
	}
	var vulnerabilities []models.Vulnerability
	if err := db.NewSelect().Model(&vulnerabilities).Where("scan_id = ?", scan.ID).Scan(ctx); err != nil {
		return nil, err
	}
	if len(vulnerabilities) == 0 {
		return []ChangedFinding{}, nil
	}
	var postures []models.VulnerabilityPosture
	if err := db.NewSelect().Model(&postures).Where("scan_id = ?", scan.ID).Scan(ctx); err != nil {
		return nil, err
	}
	postureByFinding := make(map[uuid.UUID]models.VulnerabilityPosture, len(postures))
	for _, posture := range postures {
		postureByFinding[posture.FindingID] = posture
	}

	findings := make([]ChangedFinding, 0)
	for _, vulnerability := range vulnerabilities {
		posture, ok := postureByFinding[vulnerability.ID]
		if !ok || posture.State == models.PostureStateUnchanged || !isPostScanPostureChange(scan, posture) {
			continue
		}
		severity := vulnerability.Severity
		if posture.Severity != "" && !strings.EqualFold(posture.Severity, models.SeverityUnknown) {
			severity = posture.Severity
		}
		fixedVersion := vulnerability.FixedVersion
		if len(posture.FixedVersions) > 0 {
			fixedVersion = strings.Join(posture.FixedVersions, ", ")
		}
		findings = append(findings, ChangedFinding{
			FindingID:        vulnerability.ID.String(),
			CVE:              vulnerability.VulnID,
			Package:          vulnerability.PkgName,
			InstalledVersion: vulnerability.InstalledVersion,
			FixedVersion:     fixedVersion,
			Severity:         severity,
			PostureState:     posture.State,
			CVEState:         posture.CVEState,
			Reason:           posture.Reason,
			ConflictSources:  append([]string{}, posture.ConflictSources...),
			FixedVersions:    append([]string{}, posture.FixedVersions...),
			ObservedAt:       formatTime(posture.ObservedAt),
		})
	}
	sort.Slice(findings, func(i, j int) bool {
		if findings[i].Severity != findings[j].Severity {
			return findings[i].Severity < findings[j].Severity
		}
		return findings[i].CVE < findings[j].CVE
	})
	return findings, nil
}

func isPostScanPostureChange(scan *models.Scan, posture models.VulnerabilityPosture) bool {
	if posture.ChangeEventID != nil {
		return true
	}
	return scan != nil && scan.CompletedAt != nil && posture.ObservedAt.After(scan.CompletedAt.UTC())
}

func scanSummaryFromModel(scan models.Scan, intelligence *models.IntelligenceSummary) *ScanSummary {
	summary := summarizeScan(scan, intelligence)
	return &summary
}

func normalizePage(page, limit, max int) (int, int) {
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = DefaultPageSize
	}
	if limit > max {
		limit = max
	}
	return page, limit
}

func impactMatches(impact *IntelligenceImpact, state string) bool {
	if impact == nil {
		return false
	}
	switch state {
	case "confirmation_pending", "needs_rescan":
		return impact.NeedsValidationCount > 0
	case "fix_available":
		return impact.FixAvailableCount > 0
	case "changed":
		return impact.ChangedFindingCount > 0
	default:
		return false
	}
}
