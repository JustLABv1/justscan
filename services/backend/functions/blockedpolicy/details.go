package blockedpolicy

import (
	"context"
	"strconv"
	"strings"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

const (
	IgnoreRuleStatusActiveIgnore     = "active_ignore"
	IgnoreRuleStatusNoIgnore         = "no_ignore"
	IgnoreRuleStatusUnavailable      = "status_unavailable"
	ignoreRuleSkippedMarker          = "Ignore-rule suppressions were skipped for this scan."
	ignoreRuleIncompleteLookupMarker = "optional ignore-rule lookup did not complete"
)

func AttachScanDetails(ctx context.Context, db *bun.DB, scan *models.Scan) error {
	if scan == nil {
		return nil
	}

	details, err := BuildDetails(ctx, db, scan.ID, scan.ExternalStatus, scan.ErrorMessage)
	if err != nil {
		return err
	}
	scan.BlockedPolicyDetails = details
	return nil
}

func BuildDetails(ctx context.Context, db *bun.DB, scanID uuid.UUID, externalStatus, errorMessage string) (*models.BlockedPolicyDetails, error) {
	if strings.TrimSpace(externalStatus) != models.ScanExternalStatusBlockedByXrayPolicy {
		return nil, nil
	}

	details := parseBlockedPolicyDetails(errorMessage)
	if details == nil || len(details.MatchedWatches) == 0 {
		return details, nil
	}

	activeWatches, err := loadActiveIgnoreRuleWatches(ctx, db, scanID)
	if err != nil {
		return nil, err
	}

	statusUnavailable, err := hasUnavailableIgnoreRuleStatus(ctx, db, scanID)
	if err != nil {
		return nil, err
	}

	for index := range details.MatchedWatches {
		watchName := strings.TrimSpace(details.MatchedWatches[index].Name)
		switch {
		case activeWatches[watchName]:
			details.MatchedWatches[index].IgnoreRuleStatus = IgnoreRuleStatusActiveIgnore
		case statusUnavailable:
			details.MatchedWatches[index].IgnoreRuleStatus = IgnoreRuleStatusUnavailable
		default:
			details.MatchedWatches[index].IgnoreRuleStatus = IgnoreRuleStatusNoIgnore
		}
	}

	return details, nil
}

func parseBlockedPolicyDetails(errorMessage string) *models.BlockedPolicyDetails {
	message := strings.TrimSpace(errorMessage)
	if message == "" {
		return nil
	}

	lines := make([]string, 0)
	for _, rawLine := range strings.Split(message, "\n") {
		line := strings.TrimSpace(rawLine)
		if line != "" {
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 {
		return nil
	}

	details := &models.BlockedPolicyDetails{Summary: lines[0]}
	for _, line := range lines[1:] {
		switch {
		case strings.HasPrefix(line, "Manifest: "):
			details.Manifest = strings.TrimSpace(strings.TrimPrefix(line, "Manifest: "))
		case strings.HasPrefix(line, "Artifact: "):
			details.Artifact = strings.TrimSpace(strings.TrimPrefix(line, "Artifact: "))
		case strings.HasPrefix(line, "JFrog: "):
			details.JFrog = strings.TrimSpace(strings.TrimPrefix(line, "JFrog: "))
		case strings.HasPrefix(line, "Matched issues: "):
			details.MatchedIssues = splitDelimitedValues(strings.TrimPrefix(line, "Matched issues: "))
		case strings.HasPrefix(line, "Matched watches: "):
			for _, watchName := range splitDelimitedValues(strings.TrimPrefix(line, "Matched watches: ")) {
				details.MatchedWatches = append(details.MatchedWatches, models.BlockedPolicyMatchedWatch{Name: watchName})
			}
		case strings.HasPrefix(line, "Blocking policies: "):
			details.BlockingPolicies = splitDelimitedValues(strings.TrimPrefix(line, "Blocking policies: "))
		case strings.HasPrefix(line, "Matched policies: "):
			details.MatchedPolicies = splitDelimitedValues(strings.TrimPrefix(line, "Matched policies: "))
		case strings.HasPrefix(line, "Xray violations found for this artifact: "):
			details.TotalViolations = parseViolationCount(strings.TrimPrefix(line, "Xray violations found for this artifact: "))
		}
	}

	hasStructuredDetails := details.Manifest != "" ||
		details.Artifact != "" ||
		details.JFrog != "" ||
		len(details.MatchedIssues) > 0 ||
		len(details.MatchedWatches) > 0 ||
		len(details.BlockingPolicies) > 0 ||
		len(details.MatchedPolicies) > 0 ||
		details.TotalViolations > 0
	if !hasStructuredDetails {
		return nil
	}

	return details
}

func splitDelimitedValues(value string) []string {
	parts := strings.Split(value, ",")
	results := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			results = append(results, trimmed)
		}
	}
	return results
}

func parseViolationCount(value string) int {
	count, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || count < 0 {
		return 0
	}
	return count
}

func loadActiveIgnoreRuleWatches(ctx context.Context, db *bun.DB, scanID uuid.UUID) (map[string]bool, error) {
	if scanID == uuid.Nil {
		return map[string]bool{}, nil
	}

	var watchNames []string
	if err := db.NewSelect().
		TableExpr("xray_suppressions").
		ColumnExpr("DISTINCT watch_name").
		Where("scan_id = ?", scanID).
		Where("watch_name <> ''").
		Where("expires_at IS NULL OR expires_at > now()").
		Scan(ctx, &watchNames); err != nil {
		return nil, err
	}

	results := make(map[string]bool, len(watchNames))
	for _, watchName := range watchNames {
		trimmed := strings.TrimSpace(watchName)
		if trimmed != "" {
			results[trimmed] = true
		}
	}
	return results, nil
}

func hasUnavailableIgnoreRuleStatus(ctx context.Context, db *bun.DB, scanID uuid.UUID) (bool, error) {
	if scanID == uuid.Nil {
		return false, nil
	}

	var stepLogs []models.ScanStepLog
	if err := db.NewSelect().
		Model(&stepLogs).
		Column("output").
		Where("scan_id = ?", scanID).
		Scan(ctx); err != nil {
		return false, err
	}

	for _, stepLog := range stepLogs {
		for _, line := range stepLog.Output {
			normalized := strings.TrimSpace(line)
			if strings.Contains(normalized, ignoreRuleSkippedMarker) || strings.Contains(normalized, ignoreRuleIncompleteLookupMarker) {
				return true, nil
			}
		}
	}

	return false, nil
}
