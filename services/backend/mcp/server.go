// Package mcpserver exposes the JustScan MCP surface.
//
// The HTTP adapter authenticates every request before creating a stateless MCP
// server. This keeps the MCP protocol boundary separate from Gin while still
// reusing JustScan's existing token and ownership rules.
package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"justscan-backend/compliance"
	baseauth "justscan-backend/functions/auth"
	"justscan-backend/functions/authz"
	vulnerabilityintelligence "justscan-backend/functions/vulnerabilityintelligence"
	scanhandlers "justscan-backend/handlers/scans"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/uptrace/bun"
)

const (
	DefaultPageSize = 20
	DefaultMaxPage  = 50
)

// Identity is the resolved JustScan identity used by the MCP tools.
// AccessibleOrgIDs is populated once when the stdio process starts so every
// tool call applies the same visibility boundary as the REST scan endpoints.
type Identity struct {
	UserID           uuid.UUID
	IsAdmin          bool
	AccessibleOrgIDs []uuid.UUID
}

// AuthenticatePersonalToken validates a JustScan user/personal token and
// resolves the organizations visible to that user. Org-scoped service tokens
// are deliberately kept out of this MCP surface until scoped MCP credentials
// are available.
func AuthenticatePersonalToken(ctx context.Context, db *bun.DB, signedToken string) (Identity, error) {
	if strings.TrimSpace(signedToken) == "" {
		return Identity{}, errors.New("a JustScan personal token is required")
	}

	userID, isAdmin, err := baseauth.ResolveUserAccess(signedToken, db)
	if err != nil {
		return Identity{}, fmt.Errorf("authenticate JustScan token: %w", err)
	}

	accessibleOrgIDs, err := authz.ListAccessibleOrgIDs(ctx, db, userID, isAdmin)
	if err != nil {
		return Identity{}, fmt.Errorf("resolve organization access: %w", err)
	}

	return Identity{
		UserID:           userID,
		IsAdmin:          isAdmin,
		AccessibleOrgIDs: accessibleOrgIDs,
	}, nil
}

// NewReadOnlyServer creates a compatibility server containing only the
// read-only scan tools. New integrations should use NewServer so they receive
// the complete, confirmation-gated tool set.
func NewReadOnlyServer(db *bun.DB, identity Identity, maxPageSize int) *sdk.Server {
	return newServer(db, identity, maxPageSize, false)
}

// NewServer creates the complete JustScan MCP server. Mutation tools require
// an explicit confirmation flag and an idempotency key in their input.
func NewServer(db *bun.DB, identity Identity, maxPageSize int) *sdk.Server {
	return newServer(db, identity, maxPageSize, true)
}

func newServer(db *bun.DB, identity Identity, maxPageSize int, includeActions bool) *sdk.Server {
	if maxPageSize < 1 {
		maxPageSize = DefaultMaxPage
	}
	if maxPageSize > 100 {
		maxPageSize = 100
	}

	service := &server{
		db:          db,
		identity:    identity,
		maxPageSize: maxPageSize,
	}
	server := sdk.NewServer(
		&sdk.Implementation{Name: "JustScan", Version: "mcp-stdio-v1"},
		&sdk.ServerOptions{
			Instructions: "JustScan scan intelligence. Use list_intelligence_impacts to triage CVE changes, then inspect scans or watchlists. Rescan actions require confirm=true and a unique idempotency_key.",
			PageSize:     maxPageSize,
			Capabilities: &sdk.ServerCapabilities{},
		},
	)

	sdk.AddTool(server, &sdk.Tool{
		Name:        "list_scans",
		Description: "List scans visible to the authenticated JustScan user. Search by image, tag, status, or CVE intelligence impact.",
	}, service.handleListScans)
	sdk.AddTool(server, &sdk.Tool{
		Name:        "get_scan",
		Description: "Get the authorized scan summary, posture counts, and CVE intelligence impact for a JustScan scan ID.",
	}, service.handleGetScan)

	if includeActions {
		addExtendedTools(server, service)
	}

	return server
}

type server struct {
	db          *bun.DB
	identity    Identity
	maxPageSize int
}

type ListScansInput struct {
	Query        string `json:"query,omitempty" jsonschema:"Search image name, image tag, or scan tag."`
	Image        string `json:"image,omitempty" jsonschema:"Filter by a partial image name."`
	ImageTag     string `json:"image_tag,omitempty" jsonschema:"Filter by an exact image tag."`
	Status       string `json:"status,omitempty" jsonschema:"Filter by scan status, such as completed, failed, or running."`
	Intelligence string `json:"intelligence,omitempty" jsonschema:"Filter by changed, confirmation_pending, or needs_rescan."`
	Page         int    `json:"page,omitempty" jsonschema:"One-based result page. Defaults to 1."`
	Limit        int    `json:"limit,omitempty" jsonschema:"Number of results. Defaults to 20 and is capped by the server."`
}

type ListScansOutput struct {
	Scans []ScanSummary `json:"scans" jsonschema:"Authorized scan summaries."`
	Total int           `json:"total" jsonschema:"Total number of matching authorized scans."`
	Page  int           `json:"page" jsonschema:"One-based result page."`
	Limit int           `json:"limit" jsonschema:"Number of results returned per page."`
}

type GetScanInput struct {
	ScanID string `json:"scan_id" jsonschema:"The JustScan scan UUID."`
}

type GetScanOutput struct {
	Scan ScanDetail `json:"scan" jsonschema:"Authorized scan details."`
}

type ScanSummary struct {
	ID              string              `json:"id" jsonschema:"JustScan scan UUID."`
	ImageName       string              `json:"image_name" jsonschema:"Container image repository/name."`
	ImageTag        string              `json:"image_tag" jsonschema:"Container image tag."`
	ImageDigest     string              `json:"image_digest,omitempty" jsonschema:"Resolved image digest when available."`
	Status          string              `json:"status" jsonschema:"Scan status."`
	CurrentStep     string              `json:"current_step,omitempty" jsonschema:"Current scan pipeline step."`
	ScanProvider    string              `json:"scan_provider" jsonschema:"Scan provider."`
	ScanSource      string              `json:"scan_source" jsonschema:"Scan source."`
	CriticalCount   int                 `json:"critical_count" jsonschema:"Critical vulnerability count."`
	HighCount       int                 `json:"high_count" jsonschema:"High vulnerability count."`
	MediumCount     int                 `json:"medium_count" jsonschema:"Medium vulnerability count."`
	LowCount        int                 `json:"low_count" jsonschema:"Low vulnerability count."`
	UnknownCount    int                 `json:"unknown_count" jsonschema:"Unknown severity vulnerability count."`
	SuppressedCount int                 `json:"suppressed_count" jsonschema:"Suppressed vulnerability count."`
	CreatedAt       string              `json:"created_at" jsonschema:"Creation time in RFC3339 format."`
	StartedAt       string              `json:"started_at,omitempty" jsonschema:"Start time in RFC3339 format."`
	CompletedAt     string              `json:"completed_at,omitempty" jsonschema:"Completion time in RFC3339 format."`
	Intelligence    *IntelligenceImpact `json:"intelligence,omitempty" jsonschema:"CVE intelligence changes observed after the scan."`
}

type ScanDetail struct {
	Summary        ScanSummary `json:"summary" jsonschema:"Authorized scan summary."`
	ErrorMessage   string      `json:"error_message,omitempty" jsonschema:"Non-sensitive scan error message, when present."`
	ExternalStatus string      `json:"external_status,omitempty" jsonschema:"External scanner status, when present."`
	Architecture   string      `json:"architecture,omitempty" jsonschema:"Image architecture."`
	OSFamily       string      `json:"os_family,omitempty" jsonschema:"Detected operating system family."`
	OSName         string      `json:"os_name,omitempty" jsonschema:"Detected operating system name."`
	Platform       string      `json:"platform,omitempty" jsonschema:"Detected image platform."`
	HelmChart      string      `json:"helm_chart,omitempty" jsonschema:"Helm chart identifier, when applicable."`
	Tags           []string    `json:"tags,omitempty" jsonschema:"User-defined scan tags."`
}

type IntelligenceImpact struct {
	State                string `json:"state" jsonschema:"changed or confirmation_pending."`
	ChangedCVECount      int    `json:"changed_cve_count" jsonschema:"Number of distinct CVEs whose intelligence changed."`
	ChangedFindingCount  int    `json:"changed_finding_count" jsonschema:"Number of affected vulnerability findings."`
	NeedsValidationCount int    `json:"needs_validation_count" jsonschema:"Number of findings requiring a confirming rescan."`
	FixAvailableCount    int    `json:"fix_available_count" jsonschema:"Number of findings with a newly available fix."`
	DetectedAt           string `json:"detected_at,omitempty" jsonschema:"Detection time in RFC3339 format."`
}

func (s *server) handleListScans(ctx context.Context, _ *sdk.CallToolRequest, input ListScansInput) (result *sdk.CallToolResult, output ListScansOutput, err error) {
	started := time.Now()
	defer func() { s.recordTool(ctx, "list_scans", started, err, false, false, uuid.Nil) }()
	if err = s.requireRuntime(ctx, false); err != nil {
		return nil, output, err
	}
	output, err = s.listScans(ctx, input)
	return nil, output, err
}

func (s *server) handleGetScan(ctx context.Context, _ *sdk.CallToolRequest, input GetScanInput) (result *sdk.CallToolResult, output GetScanOutput, err error) {
	started := time.Now()
	defer func() { s.recordTool(ctx, "get_scan", started, err, false, false, uuid.Nil) }()
	if err = s.requireRuntime(ctx, false); err != nil {
		return nil, output, err
	}
	output, err = s.getScan(ctx, input)
	return nil, output, err
}

func (s *server) listScans(ctx context.Context, input ListScansInput) (ListScansOutput, error) {
	page := input.Page
	if page < 1 {
		page = 1
	}
	limit := input.Limit
	if limit < 1 {
		limit = DefaultPageSize
	}
	if limit > s.maxPageSize {
		limit = s.maxPageSize
	}

	buildQuery := func(target *[]models.Scan) (*bun.SelectQuery, error) {
		q := s.db.NewSelect().Model(target)
		q = authz.ApplyOwnershipVisibility(q, "scan", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", s.identity.UserID, s.identity.IsAdmin, s.identity.AccessibleOrgIDs)
		return applyListFilters(q, input)
	}

	var countTarget []models.Scan
	countQuery, err := buildQuery(&countTarget)
	if err != nil {
		return ListScansOutput{}, err
	}
	total, err := countQuery.Count(ctx)
	if err != nil {
		return ListScansOutput{}, fmt.Errorf("count scans: %w", err)
	}

	scans := make([]models.Scan, 0, limit)
	query, err := buildQuery(&scans)
	if err != nil {
		return ListScansOutput{}, err
	}
	if err := query.OrderExpr("created_at DESC").Limit(limit).Offset((page - 1) * limit).Scan(ctx); err != nil {
		return ListScansOutput{}, fmt.Errorf("list scans: %w", err)
	}

	intelligence, err := loadIntelligence(ctx, s.db, scans)
	if err != nil {
		return ListScansOutput{}, err
	}
	result := make([]ScanSummary, 0, len(scans))
	for _, scan := range scans {
		result = append(result, summarizeScan(scan, intelligence[scan.ID]))
	}

	return ListScansOutput{Scans: result, Total: total, Page: page, Limit: limit}, nil
}

func (s *server) getScan(ctx context.Context, input GetScanInput) (GetScanOutput, error) {
	scanID, err := uuid.Parse(strings.TrimSpace(input.ScanID))
	if err != nil {
		return GetScanOutput{}, errors.New("scan_id must be a valid UUID")
	}

	scan := &models.Scan{}
	if err := s.db.NewSelect().Model(scan).Where("id = ?", scanID).Scan(ctx); err != nil {
		return GetScanOutput{}, errors.New("scan not found")
	}
	if !scanhandlers.CanReadScan(ctx, s.db, scan, scanhandlers.ScanAccessContext{
		UserID:           s.identity.UserID,
		IsAdmin:          s.identity.IsAdmin,
		AccessibleOrgIDs: s.identity.AccessibleOrgIDs,
	}) {
		return GetScanOutput{}, errors.New("scan not found")
	}

	intelligence, err := loadIntelligence(ctx, s.db, []models.Scan{*scan})
	if err != nil {
		return GetScanOutput{}, err
	}

	var tags []models.Tag
	if err := s.db.NewSelect().
		TableExpr("tags AS t").
		ColumnExpr("t.*").
		Join("JOIN scan_tags st ON st.tag_id = t.id").
		Where("st.scan_id = ?", scan.ID).
		Scan(ctx, &tags); err != nil {
		return GetScanOutput{}, fmt.Errorf("load scan tags: %w", err)
	}
	tagNames := make([]string, 0, len(tags))
	for _, tag := range tags {
		tagNames = append(tagNames, tag.Name)
	}

	return GetScanOutput{Scan: ScanDetail{
		Summary:        summarizeScan(*scan, intelligence[scan.ID]),
		ErrorMessage:   scan.ErrorMessage,
		ExternalStatus: scan.ExternalStatus,
		Architecture:   scan.Architecture,
		OSFamily:       scan.OSFamily,
		OSName:         scan.OSName,
		Platform:       scan.Platform,
		HelmChart:      scan.HelmChart,
		Tags:           tagNames,
	}}, nil
}

func applyListFilters(q *bun.SelectQuery, input ListScansInput) (*bun.SelectQuery, error) {
	if status := strings.TrimSpace(input.Status); status != "" {
		q = q.Where("status = ?", status)
	}
	if image := strings.TrimSpace(input.Image); image != "" {
		q = q.Where("image_name ILIKE ?", "%"+image+"%")
	}
	if imageTag := strings.TrimSpace(input.ImageTag); imageTag != "" {
		q = q.Where("image_tag = ?", imageTag)
	}
	if query := strings.TrimSpace(input.Query); query != "" {
		pattern := "%" + query + "%"
		q = q.Where(`(
            image_name ILIKE ?
            OR image_tag ILIKE ?
            OR (image_name || ':' || image_tag) ILIKE ?
            OR EXISTS (
                SELECT 1
                FROM scan_tags AS st
                JOIN tags AS t ON t.id = st.tag_id
                WHERE st.scan_id = scan.id AND t.name ILIKE ?
            )
        )`, pattern, pattern, pattern, pattern)
	}
	if intelligence := strings.ToLower(strings.TrimSpace(input.Intelligence)); intelligence != "" {
		condition, args, supported := intelligenceFilterCondition("scan.id", intelligence)
		if !supported {
			return nil, errors.New("unsupported intelligence filter; use changed, confirmation_pending, needs_rescan, or fix_available")
		}
		q = q.Where(condition, args...)
	}
	return q, nil
}

func intelligenceFilterCondition(scanExpr, filter string) (string, []interface{}, bool) {
	prefix := "EXISTS (SELECT 1 FROM vulnerabilities AS v JOIN vulnerability_postures AS p ON p.finding_id = v.id JOIN scans AS intelligence_scan ON intelligence_scan.id = v.scan_id WHERE v.scan_id::text = " + scanExpr + "::text AND " + vulnerabilityintelligence.PostScanChangeCondition("p", "intelligence_scan") + " AND "
	switch filter {
	case "changed":
		return prefix + "p.state IS NOT NULL AND p.state <> ?)", []interface{}{models.PostureStateUnchanged}, true
	case "confirmation_pending", "needs_rescan":
		return prefix + `(
            p.state IN (?)
            OR p.cve_state IN (?)
            OR COALESCE(jsonb_array_length(p.conflict_sources), 0) > 0
        ))`, []interface{}{
				bun.In([]string{models.PostureStateDisputed, models.PostureStateNeedsRescan}),
				bun.In([]string{models.IntelligenceCVEStateDisputed, models.IntelligenceCVEStateUnknown}),
			}, true
	case "fix_available":
		return prefix + "p.state = ?)", []interface{}{models.PostureStateFixAvailable}, true
	default:
		return "", nil, false
	}
}

func loadIntelligence(ctx context.Context, db *bun.DB, scans []models.Scan) (map[uuid.UUID]*models.IntelligenceSummary, error) {
	ids := make([]uuid.UUID, 0, len(scans))
	for _, scan := range scans {
		ids = append(ids, scan.ID)
	}
	summaries, err := compliance.LoadIntelligenceSummaries(ctx, db, ids)
	if err != nil {
		return nil, fmt.Errorf("load CVE intelligence impact: %w", err)
	}
	return summaries, nil
}

func summarizeScan(scan models.Scan, intelligence *models.IntelligenceSummary) ScanSummary {
	return ScanSummary{
		ID:              scan.ID.String(),
		ImageName:       scan.ImageName,
		ImageTag:        scan.ImageTag,
		ImageDigest:     scan.ImageDigest,
		Status:          scan.Status,
		CurrentStep:     scan.CurrentStep,
		ScanProvider:    scan.ScanProvider,
		ScanSource:      scan.ScanSource,
		CriticalCount:   scan.CriticalCount,
		HighCount:       scan.HighCount,
		MediumCount:     scan.MediumCount,
		LowCount:        scan.LowCount,
		UnknownCount:    scan.UnknownCount,
		SuppressedCount: scan.SuppressedCount,
		CreatedAt:       formatTime(scan.CreatedAt),
		StartedAt:       formatOptionalTime(scan.StartedAt),
		CompletedAt:     formatOptionalTime(scan.CompletedAt),
		Intelligence:    summarizeIntelligence(intelligence),
	}
}

func summarizeIntelligence(summary *models.IntelligenceSummary) *IntelligenceImpact {
	if summary == nil {
		return nil
	}
	return &IntelligenceImpact{
		State:                summary.State,
		ChangedCVECount:      summary.ChangedCVECount,
		ChangedFindingCount:  summary.ChangedFindingCount,
		NeedsValidationCount: summary.NeedsValidationCount,
		FixAvailableCount:    summary.FixAvailableCount,
		DetectedAt:           formatOptionalTime(summary.DetectedAt),
	}
}

func formatTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func formatOptionalTime(value *time.Time) string {
	if value == nil {
		return ""
	}
	return formatTime(*value)
}
