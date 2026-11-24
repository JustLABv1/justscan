package suppressions

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ApplySuppressionVisibility(query *bun.SelectQuery, alias string, userID *uuid.UUID, accessibleOrgIDs []uuid.UUID) *bun.SelectQuery {
	qualify := func(column string) string {
		if alias == "" {
			return column
		}
		return alias + "." + column
	}

	return query.WhereGroup(" AND ", func(q *bun.SelectQuery) *bun.SelectQuery {
		hasCondition := false
		addWhere := func(condition string, args ...interface{}) {
			if !hasCondition {
				q = q.Where(condition, args...)
				hasCondition = true
				return
			}
			q = q.WhereOr(condition, args...)
		}

		if userID != nil {
			addWhere(fmt.Sprintf("%s = ?", qualify("user_id")), *userID)
			addWhere(fmt.Sprintf("%s = ?", qualify("owner_user_id")), *userID)
		}
		if len(accessibleOrgIDs) > 0 {
			addWhere(fmt.Sprintf("%s IN (?)", qualify("owner_org_id")), bun.In(accessibleOrgIDs))
			addWhere(fmt.Sprintf("EXISTS (SELECT 1 FROM org_suppressions shared WHERE shared.suppression_id = %s AND shared.org_id IN (?))", qualify("id")), bun.In(accessibleOrgIDs))
		}
		addWhere(fmt.Sprintf("%s = ?", qualify("owner_type")), models.OwnerTypeSystem)
		if !hasCondition {
			q = q.Where("1 = 0")
		}

		return q
	})
}

func ApplySuppressionWorkspaceScope(query *bun.SelectQuery, alias, scope string, userID uuid.UUID) *bun.SelectQuery {
	if strings.TrimSpace(scope) == "" {
		return query
	}

	qualify := func(column string) string {
		if alias == "" {
			return column
		}
		return alias + "." + column
	}

	if scope == "personal" {
		return query.WhereGroup(" AND ", func(q *bun.SelectQuery) *bun.SelectQuery {
			q = q.Where(fmt.Sprintf("%s = ?", qualify("owner_type")), models.OwnerTypeSystem)
			q = q.WhereOr(fmt.Sprintf("%s = ?", qualify("owner_user_id")), userID)
			q = q.WhereOr(fmt.Sprintf("(%s = ? AND %s IS NULL)", qualify("user_id"), qualify("owner_user_id")), userID)
			return q
		})
	}

	orgID, err := uuid.Parse(strings.TrimSpace(scope))
	if err != nil {
		return query
	}

	return query.WhereGroup(" AND ", func(q *bun.SelectQuery) *bun.SelectQuery {
		q = q.Where(fmt.Sprintf("%s = ?", qualify("owner_type")), models.OwnerTypeSystem)
		q = q.WhereOr(fmt.Sprintf("%s = ?", qualify("owner_org_id")), orgID)
		q = q.WhereOr(fmt.Sprintf("EXISTS (SELECT 1 FROM org_suppressions shared WHERE shared.suppression_id = %s AND shared.org_id = ?)", qualify("id")), orgID)
		return q
	})
}

func LoadLocalSuppressionsByDigest(ctx context.Context, db *bun.DB, imageDigest string, userID *uuid.UUID, accessibleOrgIDs []uuid.UUID) (map[string]*models.Suppression, error) {
	if strings.TrimSpace(imageDigest) == "" {
		return map[string]*models.Suppression{}, nil
	}

	var suppressions []models.Suppression
	query := db.NewSelect().Model(&suppressions).
		Where("image_digest = ?", imageDigest).
		OrderExpr("CASE WHEN owner_type = ? THEN 0 ELSE 1 END ASC, updated_at DESC", models.OwnerTypeSystem)
	query = ApplySuppressionVisibility(query, "", userID, accessibleOrgIDs)
	if err := query.Scan(ctx); err != nil {
		return nil, err
	}

	results := make(map[string]*models.Suppression, len(suppressions))
	for i := range suppressions {
		if isExpiredAt(suppressions[i].ExpiresAt) {
			continue
		}
		suppressions[i].Source = "local"
		suppressions[i].Sources = []string{"local"}
		results[suppressions[i].VulnID] = &suppressions[i]
	}

	return results, nil
}

// XraySuppressionIndex holds a scan's active Xray ignore-rule snapshots by
// vulnerability ID, newest first.
type XraySuppressionIndex map[string][]*models.XraySuppression

// Match returns the newest Xray suppression that covers the finding: the
// vulnerability ID must match and, when the rule is limited to components,
// one of them must match the finding's package.
func (index XraySuppressionIndex) Match(finding *models.Vulnerability) *models.XraySuppression {
	if finding == nil {
		return nil
	}
	for _, suppression := range index[finding.VulnID] {
		if len(suppression.Components) == 0 {
			return suppression
		}
		for _, component := range suppression.Components {
			if XrayComponentMatchesFinding(component, finding) {
				return suppression
			}
		}
	}
	return nil
}

func LoadXraySuppressionsByScan(ctx context.Context, db *bun.DB, scanID uuid.UUID) (XraySuppressionIndex, error) {
	var suppressions []models.XraySuppression
	if err := db.NewSelect().Model(&suppressions).
		Where("scan_id = ?", scanID).
		OrderExpr("updated_at DESC").
		Scan(ctx); err != nil {
		return nil, err
	}

	results := make(XraySuppressionIndex, len(suppressions))
	for i := range suppressions {
		if isExpiredAt(suppressions[i].ExpiresAt) {
			continue
		}
		results[suppressions[i].VulnID] = append(results[suppressions[i].VulnID], &suppressions[i])
	}

	return results, nil
}

// XrayComponentMatchesFinding compares an Xray component reference such as
// "deb://debian:bookworm:openssl:3.0.11" (with or without version) against a
// finding's Xray component ID, package name, and installed version.
func XrayComponentMatchesFinding(ref string, finding *models.Vulnerability) bool {
	normalize := func(value string) string {
		value = strings.ToLower(strings.TrimSpace(value))
		if index := strings.Index(value, "://"); index >= 0 {
			value = value[index+3:]
		}
		return value
	}
	refValue := normalize(ref)
	if refValue == "" || finding == nil {
		return false
	}
	if componentID := normalize(finding.ExternalComponentID); componentID != "" {
		if refValue == componentID || strings.HasPrefix(componentID, refValue+":") || strings.HasPrefix(refValue, componentID+":") {
			return true
		}
	}
	pkgName := normalize(finding.PkgName)
	if pkgName == "" {
		return false
	}
	nameMatches := refValue == pkgName || strings.HasPrefix(refValue, pkgName+":") || strings.HasSuffix(refValue, ":"+pkgName) || strings.Contains(refValue, ":"+pkgName+":")
	if !nameMatches {
		return false
	}
	version := normalize(finding.InstalledVersion)
	return version == "" || refValue == pkgName || strings.HasSuffix(refValue, ":"+pkgName) || strings.HasSuffix(refValue, ":"+version)
}

func ApplyEffectiveSuppressions(ctx context.Context, db *bun.DB, scan *models.Scan, vulns []models.Vulnerability) (int, error) {
	ownerUserID, accessibleOrgIDs := suppressionScopeForScan(scan)
	localByVuln, err := LoadLocalSuppressionsByDigest(ctx, db, scan.ImageDigest, ownerUserID, accessibleOrgIDs)
	if err != nil {
		return 0, err
	}

	xrayIndex := XraySuppressionIndex{}
	if scan.ScanProvider == models.ScanProviderArtifactoryXray {
		xrayIndex, err = LoadXraySuppressionsByScan(ctx, db, scan.ID)
		if err != nil {
			return 0, err
		}
	}

	suppressedCount := 0
	for i := range vulns {
		vulns[i].Suppression = MergeEffectiveSuppression(localByVuln[vulns[i].VulnID], xrayIndex.Match(&vulns[i]))
		if vulns[i].Suppression != nil {
			suppressedCount += 1
		}
	}

	return suppressedCount, nil
}

func RecalculateSuppressedCount(ctx context.Context, db *bun.DB, scan *models.Scan) (int, error) {
	var vulns []models.Vulnerability
	if err := db.NewSelect().Model(&vulns).
		Column("vuln_id", "pkg_name", "installed_version", "external_component_id").
		Where("scan_id = ?", scan.ID).
		Scan(ctx); err != nil {
		return 0, err
	}

	return ApplyEffectiveSuppressions(ctx, db, scan, vulns)
}

func MergeEffectiveSuppression(local *models.Suppression, xray *models.XraySuppression) *models.Suppression {
	if local == nil && xray == nil {
		return nil
	}

	if local != nil && xray == nil {
		merged := *local
		merged.Source = "local"
		merged.Sources = []string{"local"}
		merged.ReadOnly = false
		return &merged
	}

	if local == nil && xray != nil {
		return xrayAsSuppression(xray)
	}

	merged := *local
	merged.Source = "mixed"
	merged.Sources = []string{"local", "xray"}
	merged.ReadOnly = false
	merged.XrayRuleID = strings.TrimSpace(xray.RuleID)
	merged.XrayPolicyName = strings.TrimSpace(xray.PolicyName)
	merged.XrayWatchName = strings.TrimSpace(xray.WatchName)
	if merged.ExpiresAt == nil && xray.ExpiresAt != nil {
		merged.ExpiresAt = xray.ExpiresAt
	}
	if strings.TrimSpace(merged.Justification) == "" {
		merged.Justification = strings.TrimSpace(xray.Justification)
	}
	return &merged
}

func LoadEffectiveSuppressionsPage(ctx context.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID, scope string, page, limit int, statusFilter, query string) ([]models.Suppression, int, error) {
	localRows, err := loadLocalSuppressionsPageRows(ctx, db, userID, isAdmin, accessibleOrgIDs, scope, statusFilter, query)
	if err != nil {
		return nil, 0, err
	}

	xrayRows, err := loadXraySuppressionsPageRows(ctx, db, userID, isAdmin, accessibleOrgIDs, scope, statusFilter, query)
	if err != nil {
		return nil, 0, err
	}

	xrayByDigestVuln := make(map[string]*models.XraySuppression, len(xrayRows))
	for i := range xrayRows {
		x := xrayRows[i]
		xrayByDigestVuln[suppressionKey(x.ImageDigest, x.VulnID)] = &x
	}

	rows := make([]models.Suppression, 0, len(localRows)+len(xrayRows))
	usedXrayKeys := make(map[string]bool, len(xrayRows))
	for i := range localRows {
		row := localRows[i]
		key := suppressionKey(row.ImageDigest, row.VulnID)
		if xrayRow, ok := xrayByDigestVuln[key]; ok {
			usedXrayKeys[key] = true
			mixed := MergeEffectiveSuppression(&row, xrayRow)
			if mixed != nil {
				rows = append(rows, *mixed)
			}
			continue
		}
		row.Source = "local"
		row.Sources = []string{"local"}
		row.ReadOnly = false
		rows = append(rows, row)
	}

	for i := range xrayRows {
		xrayRow := xrayRows[i]
		key := suppressionKey(xrayRow.ImageDigest, xrayRow.VulnID)
		if usedXrayKeys[key] {
			continue
		}
		xraySuppression := xrayAsSuppression(&xrayRow)
		if xraySuppression != nil {
			rows = append(rows, *xraySuppression)
		}
	}

	sort.Slice(rows, func(i, j int) bool {
		if rows[i].UpdatedAt.Equal(rows[j].UpdatedAt) {
			return rows[i].CreatedAt.After(rows[j].CreatedAt)
		}
		return rows[i].UpdatedAt.After(rows[j].UpdatedAt)
	})

	total := len(rows)
	start := (page - 1) * limit
	if start >= total {
		return []models.Suppression{}, total, nil
	}
	end := start + limit
	if end > total {
		end = total
	}

	return rows[start:end], total, nil
}

func loadLocalSuppressionsPageRows(ctx context.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID, scope, statusFilter, query string) ([]models.Suppression, error) {
	var suppressions []models.Suppression
	q := db.NewSelect().Model(&suppressions).OrderExpr("updated_at DESC")
	if !isAdmin {
		q = ApplySuppressionVisibility(q, "", &userID, accessibleOrgIDs)
	}
	q = ApplySuppressionWorkspaceScope(q, "", scope, userID)
	if strings.TrimSpace(statusFilter) != "" {
		q = q.Where("status = ?", statusFilter)
	}
	if trimmedQuery := strings.TrimSpace(query); trimmedQuery != "" {
		q = q.Where("vuln_id ILIKE ? OR image_digest ILIKE ?", "%"+trimmedQuery+"%", "%"+trimmedQuery+"%")
	}
	if err := q.Scan(ctx); err != nil {
		return nil, err
	}

	rows := make([]models.Suppression, 0, len(suppressions))
	for i := range suppressions {
		if isExpiredAt(suppressions[i].ExpiresAt) {
			continue
		}
		rows = append(rows, suppressions[i])
	}
	return rows, nil
}

func loadXraySuppressionsPageRows(ctx context.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID, scope, statusFilter, query string) ([]models.XraySuppression, error) {
	if strings.TrimSpace(statusFilter) != "" && statusFilter != models.SuppressionXrayIgnore {
		return []models.XraySuppression{}, nil
	}

	var suppressions []models.XraySuppression
	q := db.NewSelect().Model(&suppressions).
		Join("JOIN scans ON scans.id = xray_suppression.scan_id").
		DistinctOn("image_digest, vuln_id").
		OrderExpr("image_digest, vuln_id, updated_at DESC")
	if !isAdmin {
		q = authz.ApplyOwnershipVisibility(q, "scans", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
	}
	q = authz.ApplyWorkspaceScopeValue(q, "scans", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, scope)
	if trimmedQuery := strings.TrimSpace(query); trimmedQuery != "" {
		q = q.Where("vuln_id ILIKE ? OR image_digest ILIKE ? OR policy_name ILIKE ? OR watch_name ILIKE ?", "%"+trimmedQuery+"%", "%"+trimmedQuery+"%", "%"+trimmedQuery+"%", "%"+trimmedQuery+"%")
	}
	if err := q.Scan(ctx); err != nil {
		return nil, err
	}

	rows := make([]models.XraySuppression, 0, len(suppressions))
	for i := range suppressions {
		if isExpiredAt(suppressions[i].ExpiresAt) {
			continue
		}
		rows = append(rows, suppressions[i])
	}
	return rows, nil
}

func xrayAsSuppression(xray *models.XraySuppression) *models.Suppression {
	if xray == nil {
		return nil
	}

	return &models.Suppression{
		ID:             xray.ID,
		ImageDigest:    xray.ImageDigest,
		VulnID:         xray.VulnID,
		Status:         models.SuppressionXrayIgnore,
		Justification:  xrayJustification(xray),
		OwnerType:      models.OwnerTypeSystem,
		ExpiresAt:      xray.ExpiresAt,
		CreatedAt:      xray.CreatedAt,
		UpdatedAt:      xray.UpdatedAt,
		Username:       "Xray",
		Source:         "xray",
		Sources:        []string{"xray"},
		ReadOnly:       true,
		XrayRuleID:     strings.TrimSpace(xray.RuleID),
		XrayPolicyName: strings.TrimSpace(xray.PolicyName),
		XrayWatchName:  strings.TrimSpace(xray.WatchName),
	}
}

func xrayJustification(xray *models.XraySuppression) string {
	if xray == nil {
		return ""
	}
	parts := make([]string, 0, 3)
	if policy := strings.TrimSpace(xray.PolicyName); policy != "" {
		parts = append(parts, "Policy: "+policy)
	}
	if watch := strings.TrimSpace(xray.WatchName); watch != "" {
		parts = append(parts, "Watch: "+watch)
	}
	if reason := strings.TrimSpace(xray.Justification); reason != "" {
		parts = append(parts, reason)
	}
	return strings.Join(parts, " | ")
}

func suppressionKey(imageDigest, vulnID string) string {
	return strings.TrimSpace(imageDigest) + "\x00" + strings.TrimSpace(vulnID)
}

func isExpiredAt(expiresAt *time.Time) bool {
	if expiresAt == nil {
		return false
	}
	return expiresAt.Before(time.Now())
}

func suppressionScopeForScan(scan *models.Scan) (*uuid.UUID, []uuid.UUID) {
	if scan == nil {
		return nil, nil
	}
	if scan.OwnerOrgID != nil {
		return nil, []uuid.UUID{*scan.OwnerOrgID}
	}
	if scan.OwnerUserID != nil {
		return scan.OwnerUserID, nil
	}
	return scan.UserID, nil
}
