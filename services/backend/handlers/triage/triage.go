package triage

import (
	"context"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type itemKind string

type priority string

const (
	kindScan      itemKind = "scan"
	kindPolicy    itemKind = "policy"
	kindFix       itemKind = "fix"
	kindWatchlist itemKind = "watchlist"

	priorityCritical priority = "critical"
	priorityHigh     priority = "high"
	priorityMedium   priority = "medium"
)

type severityCounts struct {
	Critical int `json:"critical"`
	High     int `json:"high"`
	Medium   int `json:"medium"`
	Low      int `json:"low"`
	Unknown  int `json:"unknown"`
}

type triageItem struct {
	ID             string                `json:"id"`
	Kind           itemKind              `json:"kind"`
	Priority       priority              `json:"priority"`
	Title          string                `json:"title"`
	Description    string                `json:"description"`
	Href           string                `json:"href"`
	PrimaryAction  string                `json:"primary_action"`
	Signals        []string              `json:"signals"`
	SeverityCounts severityCounts        `json:"severity_counts"`
	FixCount       int                   `json:"fix_count"`
	PolicyNames    []string              `json:"policy_names,omitempty"`
	Scan           *models.Scan          `json:"scan,omitempty"`
	WatchlistItem  *models.WatchlistItem `json:"watchlist_item,omitempty"`
	UpdatedAt      time.Time             `json:"updated_at"`
}

type triageSummary struct {
	Total          int `json:"total"`
	Critical       int `json:"critical"`
	High           int `json:"high"`
	Medium         int `json:"medium"`
	Fixable        int `json:"fixable"`
	PolicyFailures int `json:"policy_failures"`
	Watchlist      int `json:"watchlist"`
}

type response struct {
	Items      []triageItem    `json:"items"`
	Summary    triageSummary   `json:"summary"`
	Pagination paginationState `json:"pagination"`
}

type paginationState struct {
	Total   int  `json:"total"`
	Limit   int  `json:"limit"`
	Offset  int  `json:"offset"`
	HasMore bool `json:"has_more"`
}

type vulnFixRow struct {
	ScanID           uuid.UUID `bun:"scan_id"`
	FixCount         int       `bun:"fix_count"`
	CriticalFixCount int       `bun:"critical_fix_count"`
	HighFixCount     int       `bun:"high_fix_count"`
}

type policyRow struct {
	ScanID      uuid.UUID `bun:"scan_id"`
	PolicyName  string    `bun:"policy_name"`
	EvaluatedAt time.Time `bun:"evaluated_at"`
}

func GetTriage(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}

		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		if limit < 1 || limit > 100 {
			limit = 50
		}
		offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
		if offset < 0 {
			offset = 0
		}
		kindFilter := strings.TrimSpace(strings.ToLower(c.DefaultQuery("kind", "all")))
		priorityFilter := strings.TrimSpace(strings.ToLower(c.DefaultQuery("priority", "all")))
		queryFilter := strings.TrimSpace(strings.ToLower(c.DefaultQuery("q", "")))

		scans, err := loadAttentionScans(c, db, userID, isAdmin, accessibleOrgIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load triage scans"})
			return
		}

		policyRows, err := loadPolicyRows(c, db, userID, isAdmin, accessibleOrgIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load policy triage"})
			return
		}

		scansByID := make(map[uuid.UUID]*models.Scan)
		scanIDs := make([]uuid.UUID, 0, len(scans)+len(policyRows))
		for index := range scans {
			scansByID[scans[index].ID] = &scans[index]
			scanIDs = append(scanIDs, scans[index].ID)
		}
		for _, row := range policyRows {
			if _, exists := scansByID[row.ScanID]; exists {
				continue
			}
			scanIDs = append(scanIDs, row.ScanID)
		}

		if err := loadMissingPolicyScans(c, db, userID, isAdmin, accessibleOrgIDs, policyRows, scansByID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load policy scans"})
			return
		}

		fixCounts, err := loadFixCounts(ctx, db, scanIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load fix counts"})
			return
		}
		policyNamesByScan := groupPolicyNames(policyRows)
		policyTimesByScan := groupPolicyTimes(policyRows)

		items := make([]triageItem, 0, limit+10)
		for _, scan := range scansByID {
			if scan == nil {
				continue
			}
			fixes := fixCounts[scan.ID]
			policies := policyNamesByScan[scan.ID]
			policyTime := policyTimesByScan[scan.ID]

			if scan.Status == models.ScanStatusFailed || scan.Status == models.ScanStatusPending || scan.Status == models.ScanStatusRunning {
				items = append(items, scanStatusItem(scan, fixes, policies, policyTime))
			}
			if len(policies) > 0 {
				items = append(items, policyItem(scan, fixes, policies, policyTime))
			}
			if fixes.CriticalFixCount+fixes.HighFixCount > 0 {
				items = append(items, fixItem(scan, fixes))
			}
		}

		watchlistItems, err := loadWatchlistItems(c, db, userID, isAdmin, accessibleOrgIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load watchlist triage"})
			return
		}
		items = append(items, watchlistTriageItems(watchlistItems)...)

		sort.SliceStable(items, func(i, j int) bool {
			leftRank := priorityRank(items[i].Priority)
			rightRank := priorityRank(items[j].Priority)
			if leftRank != rightRank {
				return leftRank < rightRank
			}
			return items[i].UpdatedAt.After(items[j].UpdatedAt)
		})

		filtered := filterItems(items, kindFilter, priorityFilter, queryFilter)
		total := len(filtered)
		if offset > total {
			offset = total
		}
		end := offset + limit
		if end > total {
			end = total
		}
		paged := filtered[offset:end]

		c.JSON(http.StatusOK, response{
			Items:   paged,
			Summary: summarize(filtered),
			Pagination: paginationState{
				Total:   total,
				Limit:   limit,
				Offset:  offset,
				HasMore: end < total,
			},
		})
	}
}

func filterItems(items []triageItem, kindFilter, priorityFilter, query string) []triageItem {
	if kindFilter == "" {
		kindFilter = "all"
	}
	if priorityFilter == "" {
		priorityFilter = "all"
	}
	filtered := make([]triageItem, 0, len(items))
	for _, item := range items {
		if kindFilter != "all" && string(item.Kind) != kindFilter {
			continue
		}
		if priorityFilter != "all" && string(item.Priority) != priorityFilter {
			continue
		}
		if query != "" && !matchesQuery(item, query) {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func matchesQuery(item triageItem, query string) bool {
	candidates := []string{
		item.Title,
		item.Description,
		strings.Join(item.Signals, " "),
		strings.Join(item.PolicyNames, " "),
	}
	if item.Scan != nil {
		candidates = append(candidates, item.Scan.ImageName, item.Scan.ImageTag, item.Scan.Status, item.Scan.ExternalStatus)
	}
	if item.WatchlistItem != nil {
		candidates = append(candidates, item.WatchlistItem.ImageName, item.WatchlistItem.ImageTag)
	}
	for _, candidate := range candidates {
		if strings.Contains(strings.ToLower(candidate), query) {
			return true
		}
	}
	return false
}

func loadAttentionScans(c *gin.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID) ([]models.Scan, error) {
	var scans []models.Scan
	q := db.NewSelect().Model(&scans).
		Where("scan.id IN (?)", latestVisibleScanIDsQuery(c, db, userID, isAdmin, accessibleOrgIDs, "latest_scan")).
		WhereGroup(" AND ", func(q *bun.SelectQuery) *bun.SelectQuery {
			return q.Where("scan.status = ?", models.ScanStatusFailed).
				WhereOr("scan.status IN (?)", bun.In([]string{models.ScanStatusPending, models.ScanStatusRunning})).
				WhereOr("scan.critical_count > 0").
				WhereOr("scan.high_count > 0")
		}).
		OrderExpr("scan.created_at DESC").
		Limit(120)
	q = authz.ApplyOwnershipVisibility(q, "scan", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
	q = authz.ApplyWorkspaceScope(c, q, "scan", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
	return scans, q.Scan(c.Request.Context())
}

func loadMissingPolicyScans(c *gin.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID, rows []policyRow, scansByID map[uuid.UUID]*models.Scan) error {
	missing := make([]uuid.UUID, 0)
	seen := make(map[uuid.UUID]struct{})
	for _, row := range rows {
		if _, exists := scansByID[row.ScanID]; exists {
			continue
		}
		if _, exists := seen[row.ScanID]; exists {
			continue
		}
		seen[row.ScanID] = struct{}{}
		missing = append(missing, row.ScanID)
	}
	if len(missing) == 0 {
		return nil
	}

	var scans []models.Scan
	q := db.NewSelect().Model(&scans).Where("scan.id IN (?)", bun.In(missing))
	q = authz.ApplyOwnershipVisibility(q, "scan", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
	q = authz.ApplyWorkspaceScope(c, q, "scan", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
	if err := q.Scan(c.Request.Context()); err != nil {
		return err
	}
	for index := range scans {
		scansByID[scans[index].ID] = &scans[index]
	}
	return nil
}

func loadFixCounts(ctx context.Context, db *bun.DB, scanIDs []uuid.UUID) (map[uuid.UUID]vulnFixRow, error) {
	result := make(map[uuid.UUID]vulnFixRow)
	if len(scanIDs) == 0 {
		return result, nil
	}
	var rows []vulnFixRow
	if err := db.NewSelect().
		TableExpr("vulnerabilities").
		ColumnExpr("scan_id").
		ColumnExpr("COUNT(*) FILTER (WHERE fixed_version != '') AS fix_count").
		ColumnExpr("COUNT(*) FILTER (WHERE fixed_version != '' AND severity = ?) AS critical_fix_count", models.SeverityCritical).
		ColumnExpr("COUNT(*) FILTER (WHERE fixed_version != '' AND severity = ?) AS high_fix_count", models.SeverityHigh).
		Where("scan_id IN (?)", bun.In(scanIDs)).
		GroupExpr("scan_id").
		Scan(ctx, &rows); err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.ScanID] = row
	}
	return result, nil
}

func loadPolicyRows(c *gin.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID) ([]policyRow, error) {
	var rows []policyRow
	q := db.NewSelect().
		TableExpr("compliance_results AS cr").
		ColumnExpr("cr.scan_id").
		ColumnExpr("COALESCE(p.name, 'Organization policy') AS policy_name").
		ColumnExpr("MAX(cr.evaluated_at) AS evaluated_at").
		Join("JOIN scans AS s ON s.id = cr.scan_id").
		Join("LEFT JOIN org_policies AS p ON p.id = cr.policy_id").
		Where("cr.scan_id IN (?)", latestVisibleScanIDsQuery(c, db, userID, isAdmin, accessibleOrgIDs, "latest_scan")).
		Where("cr.status = ?", "fail").
		GroupExpr("cr.scan_id, p.name").
		OrderExpr("MAX(cr.evaluated_at) DESC").
		Limit(120)
	q = authz.ApplyOwnershipVisibility(q, "s", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
	q = authz.ApplyWorkspaceScope(c, q, "s", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
	if !isAdmin {
		if len(accessibleOrgIDs) == 0 {
			return rows, nil
		}
		q = q.Where("cr.org_id IN (?)", bun.In(accessibleOrgIDs))
	}
	if orgID, scoped := scopedOrgID(c.Query("scope")); scoped {
		q = q.Where("cr.org_id = ?", orgID)
	}
	return rows, q.Scan(c.Request.Context(), &rows)
}

func loadWatchlistItems(c *gin.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID) ([]models.WatchlistItem, error) {
	var items []models.WatchlistItem
	q := db.NewSelect().Model(&items).
		Where("enabled = true").
		OrderExpr("created_at DESC").
		Limit(120)
	q = authz.ApplyOwnershipVisibility(q, "", "user_id", "owner_user_id", "owner_org_id", "org_watchlist_items", "watchlist_item_id", userID, isAdmin, accessibleOrgIDs)
	q = authz.ApplyWorkspaceScope(c, q, "", "owner_user_id", "owner_org_id", "org_watchlist_items", "watchlist_item_id", userID)
	if err := q.Scan(c.Request.Context()); err != nil {
		return nil, err
	}
	return items, attachLastScans(c.Request.Context(), db, items)
}

func latestVisibleScanIDsQuery(c *gin.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID, alias string) *bun.SelectQuery {
	q := db.NewSelect().
		TableExpr("scans AS " + alias).
		ColumnExpr(
			"DISTINCT ON (" + alias + ".image_name, " + alias + ".image_tag, COALESCE(" + alias + ".platform, ''), " + alias + ".owner_type, COALESCE(" + alias + ".owner_user_id::text, ''), COALESCE(" + alias + ".owner_org_id::text, '')) " + alias + ".id",
		).
		OrderExpr(
			alias + ".image_name, " +
				alias + ".image_tag, " +
				"COALESCE(" + alias + ".platform, ''), " +
				alias + ".owner_type, " +
				"COALESCE(" + alias + ".owner_user_id::text, ''), " +
				"COALESCE(" + alias + ".owner_org_id::text, ''), " +
				alias + ".created_at DESC, " +
				alias + ".id DESC",
		)
	q = authz.ApplyOwnershipVisibility(q, alias, "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
	q = authz.ApplyWorkspaceScope(c, q, alias, "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
	return q
}

func attachLastScans(ctx context.Context, db *bun.DB, items []models.WatchlistItem) error {
	scanIDs := make([]uuid.UUID, 0, len(items))
	seen := make(map[uuid.UUID]struct{})
	for _, item := range items {
		if item.LastScanID == nil {
			continue
		}
		if _, exists := seen[*item.LastScanID]; exists {
			continue
		}
		seen[*item.LastScanID] = struct{}{}
		scanIDs = append(scanIDs, *item.LastScanID)
	}
	if len(scanIDs) == 0 {
		return nil
	}
	var scans []models.Scan
	if err := db.NewSelect().Model(&scans).Where("id IN (?)", bun.In(scanIDs)).Scan(ctx); err != nil {
		return err
	}
	byID := make(map[uuid.UUID]*models.Scan, len(scans))
	for index := range scans {
		byID[scans[index].ID] = &scans[index]
	}
	for index := range items {
		if items[index].LastScanID != nil {
			items[index].LastScan = byID[*items[index].LastScanID]
		}
	}
	return nil
}

func watchlistTriageItems(items []models.WatchlistItem) []triageItem {
	result := make([]triageItem, 0)
	now := time.Now()
	for index := range items {
		item := &items[index]
		if item.LastScanID == nil {
			result = append(result, watchlistItem(item, priorityHigh, "Watchlist has no baseline", "This scheduled image has never completed a scan.", "Open watchlist", now, []string{"never scanned"}))
			continue
		}
		lastSeen := valueTime(item.LastScannedAt)
		if lastSeen.IsZero() && item.LastScan != nil {
			lastSeen = latest(valueTime(item.LastScan.CompletedAt), item.LastScan.CreatedAt)
		}
		if !lastSeen.IsZero() && now.Sub(lastSeen) > 7*24*time.Hour {
			result = append(result, watchlistItem(item, priorityMedium, "Watchlist coverage is stale", "Last scan is older than 7 days.", "Open watchlist", lastSeen, []string{"stale coverage"}))
		}
		if item.LastScan != nil && item.LastScan.Status == models.ScanStatusFailed {
			result = append(result, watchlistItem(item, priorityHigh, "Watchlist scan failed", "The latest scheduled scan did not complete.", "Open scan", latest(valueTime(item.LastScan.CompletedAt), item.LastScan.CreatedAt), []string{"scan failed"}))
		}
	}
	return result
}

func watchlistItem(item *models.WatchlistItem, prio priority, title, description, action string, updatedAt time.Time, signals []string) triageItem {
	href := "/watchlist"
	if item.LastScanID != nil {
		href = "/scans/" + item.LastScanID.String()
	}
	return triageItem{
		ID:            string(kindWatchlist) + ":" + item.ID.String() + ":" + strings.Join(signals, ","),
		Kind:          kindWatchlist,
		Priority:      prio,
		Title:         title,
		Description:   description,
		Href:          href,
		PrimaryAction: action,
		Signals:       dedupeStrings(signals),
		WatchlistItem: item,
		UpdatedAt:     updatedAt,
	}
}

func scanStatusItem(scan *models.Scan, fixes vulnFixRow, policies []string, policyTime time.Time) triageItem {
	kind := kindScan
	prio := priorityHigh
	title := "Scan needs attention"
	description := "Review scan status and logs."
	action := "Open scan"
	signals := []string{scan.Status}
	if scan.ExternalStatus == models.ScanExternalStatusBlockedByXrayPolicy {
		kind = kindPolicy
		prio = priorityCritical
		title = "Xray policy blocked this scan"
		description = "The artifact was blocked before a normal scan completion path."
		action = "Review policy details"
		signals = append(signals, "xray blocked")
	} else if scan.Status == models.ScanStatusFailed {
		title = "Scan failed"
		description = strings.TrimSpace(scan.ErrorMessage)
		if description == "" {
			description = "The scan did not complete successfully."
		}
	} else if scan.Status == models.ScanStatusPending || scan.Status == models.ScanStatusRunning {
		prio = priorityMedium
		title = "Scan in flight"
		description = strings.ReplaceAll(scan.CurrentStep, "_", " ")
		if description == "" {
			description = "Scanner work is still in progress."
		}
	}
	if len(policies) > 0 {
		signals = append(signals, "policy failed")
	}
	return baseScanItem(scan, fixes, policies, kind, prio, title, description, action, latest(scan.CreatedAt, valueTime(scan.CompletedAt), policyTime), signals)
}

func policyItem(scan *models.Scan, fixes vulnFixRow, policies []string, policyTime time.Time) triageItem {
	description := "Organization policy failed"
	if len(policies) > 0 {
		description = strings.Join(firstStrings(policies, 3), ", ")
	}
	return baseScanItem(scan, fixes, policies, kindPolicy, priorityCritical, "Policy failure", description, "Review compliance", latest(scan.CreatedAt, policyTime), []string{"policy failed"})
}

func fixItem(scan *models.Scan, fixes vulnFixRow) triageItem {
	fixable := fixes.CriticalFixCount + fixes.HighFixCount
	description := strconv.Itoa(fixable) + " critical/high finding"
	if fixable != 1 {
		description += "s"
	}
	description += " have a fixed version available."
	return baseScanItem(scan, fixes, nil, kindFix, priorityHigh, "Fixes available", description, "Acknowledge findings", latest(scan.CreatedAt, valueTime(scan.CompletedAt)), []string{"fix available"})
}

func baseScanItem(scan *models.Scan, fixes vulnFixRow, policies []string, kind itemKind, prio priority, title, description, action string, updatedAt time.Time, signals []string) triageItem {
	href := "/scans/" + scan.ID.String()
	if kind == kindFix {
		params := url.Values{}
		params.Set("tab", "vulns")
		params.Set("severity", "CRITICAL,HIGH")
		params.Set("has_fix", "true")
		params.Set("suppressed", "false")
		params.Set("sort_by", "severity")
		params.Set("sort_dir", "desc")
		params.Set("triage_focus", "acknowledge")
		href += "?" + params.Encode()
	}

	return triageItem{
		ID:             string(kind) + ":" + scan.ID.String(),
		Kind:           kind,
		Priority:       prio,
		Title:          title,
		Description:    description,
		Href:           href,
		PrimaryAction:  action,
		Signals:        dedupeStrings(signals),
		SeverityCounts: severityCounts{Critical: scan.CriticalCount, High: scan.HighCount, Medium: scan.MediumCount, Low: scan.LowCount, Unknown: scan.UnknownCount},
		FixCount:       fixes.FixCount,
		PolicyNames:    policies,
		Scan:           scan,
		UpdatedAt:      updatedAt,
	}
}

func groupPolicyNames(rows []policyRow) map[uuid.UUID][]string {
	sets := make(map[uuid.UUID]map[string]struct{})
	for _, row := range rows {
		name := strings.TrimSpace(row.PolicyName)
		if name == "" {
			continue
		}
		if sets[row.ScanID] == nil {
			sets[row.ScanID] = make(map[string]struct{})
		}
		sets[row.ScanID][name] = struct{}{}
	}
	result := make(map[uuid.UUID][]string, len(sets))
	for scanID, set := range sets {
		result[scanID] = sortedSet(set)
	}
	return result
}

func groupPolicyTimes(rows []policyRow) map[uuid.UUID]time.Time {
	result := make(map[uuid.UUID]time.Time)
	for _, row := range rows {
		if row.EvaluatedAt.After(result[row.ScanID]) {
			result[row.ScanID] = row.EvaluatedAt
		}
	}
	return result
}

func summarize(items []triageItem) triageSummary {
	summary := triageSummary{Total: len(items)}
	for _, item := range items {
		switch item.Priority {
		case priorityCritical:
			summary.Critical++
		case priorityHigh:
			summary.High++
		case priorityMedium:
			summary.Medium++
		}
		if item.FixCount > 0 {
			summary.Fixable++
		}
		if item.Kind == kindPolicy {
			summary.PolicyFailures++
		}
		if item.Kind == kindWatchlist {
			summary.Watchlist++
		}
	}
	return summary
}

func priorityRank(value priority) int {
	switch value {
	case priorityCritical:
		return 0
	case priorityHigh:
		return 1
	default:
		return 2
	}
}

func scopedOrgID(scope string) (uuid.UUID, bool) {
	trimmed := strings.TrimSpace(scope)
	if trimmed == "" || strings.EqualFold(trimmed, "personal") {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(trimmed)
	return id, err == nil
}

func valueTime(value *time.Time) time.Time {
	if value == nil {
		return time.Time{}
	}
	return *value
}

func latest(values ...time.Time) time.Time {
	var result time.Time
	for _, value := range values {
		if value.After(result) {
			result = value
		}
	}
	return result
}

func firstStrings(values []string, count int) []string {
	if len(values) <= count {
		return values
	}
	return values[:count]
}

func dedupeStrings(values []string) []string {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			set[trimmed] = struct{}{}
		}
	}
	return sortedSet(set)
}

func sortedSet(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}
