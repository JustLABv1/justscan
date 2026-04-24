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
		if !hasCondition {
			q = q.Where("1 = 0")
		}

		return q
	})
}

func LoadLocalSuppressionsByDigest(ctx context.Context, db *bun.DB, imageDigest string, userID *uuid.UUID, accessibleOrgIDs []uuid.UUID) (map[string]*models.Suppression, error) {
	if strings.TrimSpace(imageDigest) == "" {
		return map[string]*models.Suppression{}, nil
	}
	if userID == nil && len(accessibleOrgIDs) == 0 {
		return map[string]*models.Suppression{}, nil
	}

	var suppressions []models.Suppression
	query := db.NewSelect().Model(&suppressions).
		Where("image_digest = ?", imageDigest)
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

func LoadXraySuppressionsByScan(ctx context.Context, db *bun.DB, scanID uuid.UUID) (map[string]*models.XraySuppression, error) {
	var suppressions []models.XraySuppression
	if err := db.NewSelect().Model(&suppressions).
		Where("scan_id = ?", scanID).
		OrderExpr("updated_at DESC").
		Scan(ctx); err != nil {
		return nil, err
	}

	results := make(map[string]*models.XraySuppression, len(suppressions))
	for i := range suppressions {
		if isExpiredAt(suppressions[i].ExpiresAt) {
			continue
		}
		if _, exists := results[suppressions[i].VulnID]; exists {
			continue
		}
		results[suppressions[i].VulnID] = &suppressions[i]
	}

	return results, nil
}

func ApplyEffectiveSuppressions(ctx context.Context, db *bun.DB, scan *models.Scan, vulns []models.Vulnerability) (int, error) {
	ownerUserID, accessibleOrgIDs := suppressionScopeForScan(scan)
	localByVuln, err := LoadLocalSuppressionsByDigest(ctx, db, scan.ImageDigest, ownerUserID, accessibleOrgIDs)
	if err != nil {
		return 0, err
	}

	xrayByVuln := map[string]*models.XraySuppression{}
	if scan.ScanProvider == models.ScanProviderArtifactoryXray {
		xrayByVuln, err = LoadXraySuppressionsByScan(ctx, db, scan.ID)
		if err != nil {
			return 0, err
		}
	}

	suppressedCount := 0
	for i := range vulns {
		vulns[i].Suppression = MergeEffectiveSuppression(localByVuln[vulns[i].VulnID], xrayByVuln[vulns[i].VulnID])
		if vulns[i].Suppression != nil {
			suppressedCount += 1
		}
	}

	return suppressedCount, nil
}

func RecalculateSuppressedCount(ctx context.Context, db *bun.DB, scan *models.Scan) (int, error) {
	var vulns []models.Vulnerability
	if err := db.NewSelect().Model(&vulns).
		Column("vuln_id").
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

func LoadEffectiveSuppressionsPage(ctx context.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID, page, limit int, statusFilter, query string) ([]models.Suppression, int, error) {
	localRows, err := loadLocalSuppressionsPageRows(ctx, db, userID, isAdmin, accessibleOrgIDs, statusFilter, query)
	if err != nil {
		return nil, 0, err
	}

	xrayRows, err := loadXraySuppressionsPageRows(ctx, db, userID, isAdmin, accessibleOrgIDs, statusFilter, query)
	if err != nil {
		return nil, 0, err
	}

	merged := make(map[string]*models.Suppression, len(localRows)+len(xrayRows))
	for i := range localRows {
		row := localRows[i]
		row.Source = "local"
		row.Sources = []string{"local"}
		row.ReadOnly = false
		merged[suppressionKey(row.ImageDigest, row.VulnID)] = &row
	}

	for i := range xrayRows {
		xrayRow := xrayRows[i]
		key := suppressionKey(xrayRow.ImageDigest, xrayRow.VulnID)
		if existing, ok := merged[key]; ok {
			mixed := MergeEffectiveSuppression(existing, &xrayRow)
			if mixed != nil {
				merged[key] = mixed
			}
			continue
		}
		merged[key] = xrayAsSuppression(&xrayRow)
	}

	rows := make([]models.Suppression, 0, len(merged))
	for _, row := range merged {
		rows = append(rows, *row)
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

func loadLocalSuppressionsPageRows(ctx context.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID, statusFilter, query string) ([]models.Suppression, error) {
	var suppressions []models.Suppression
	q := db.NewSelect().Model(&suppressions).OrderExpr("updated_at DESC")
	if !isAdmin {
		q = ApplySuppressionVisibility(q, "", &userID, accessibleOrgIDs)
	}
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

func loadXraySuppressionsPageRows(ctx context.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID, statusFilter, query string) ([]models.XraySuppression, error) {
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
