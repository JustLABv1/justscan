package scans

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func scopedOrgIDFromRequest(c *gin.Context) (uuid.UUID, bool) {
	return scopedOrgIDFromScopeValue(c.Query("scope"))
}

func scopedOrgIDFromScopeValue(scope string) (uuid.UUID, bool) {
	trimmed := strings.TrimSpace(scope)
	if trimmed == "" || strings.EqualFold(trimmed, "personal") {
		return uuid.Nil, false
	}

	orgID, err := uuid.Parse(trimmed)
	if err != nil {
		return uuid.Nil, false
	}

	return orgID, true
}

func buildScanComplianceSummaries(
	ctx context.Context,
	db *bun.DB,
	scanIDs []uuid.UUID,
	orgID uuid.UUID,
) (map[uuid.UUID]*models.ScanComplianceSummary, error) {
	summaries := make(map[uuid.UUID]*models.ScanComplianceSummary)
	if len(scanIDs) == 0 {
		return summaries, nil
	}

	var rows []models.ComplianceResult
	if err := db.NewSelect().
		Model(&rows).
		Where("scan_id IN (?)", bun.In(scanIDs)).
		Where("org_id = ?", orgID).
		Scan(ctx); err != nil {
		return nil, err
	}

	if len(rows) == 0 {
		return summaries, nil
	}

	policyIDs := make([]uuid.UUID, 0, len(rows))
	seenPolicyIDs := make(map[uuid.UUID]struct{}, len(rows))
	for _, row := range rows {
		if _, ok := seenPolicyIDs[row.PolicyID]; ok {
			continue
		}
		seenPolicyIDs[row.PolicyID] = struct{}{}
		policyIDs = append(policyIDs, row.PolicyID)
	}

	policyNames := make(map[uuid.UUID]string, len(policyIDs))
	policyDetails := make(map[uuid.UUID]models.ScanCompliancePolicy, len(policyIDs))
	if len(policyIDs) > 0 {
		var policies []models.OrgPolicy
		if err := db.NewSelect().Model(&policies).Where("id IN (?)", bun.In(policyIDs)).Scan(ctx); err != nil {
			return nil, err
		}
		for _, policy := range policies {
			name := strings.TrimSpace(policy.Name)
			policyNames[policy.ID] = name
			policyDetails[policy.ID] = models.ScanCompliancePolicy{
				Name:          name,
				RuleSummaries: summarizePolicyRules(policy.Rules),
			}
		}
	}

	return summarizeScanComplianceRows(rows, policyNames, policyDetails), nil
}

func summarizeScanComplianceRows(
	rows []models.ComplianceResult,
	policyNames map[uuid.UUID]string,
	policyDetails map[uuid.UUID]models.ScanCompliancePolicy,
) map[uuid.UUID]*models.ScanComplianceSummary {
	type summaryAccumulator struct {
		summary           *models.ScanComplianceSummary
		policies          map[string]struct{}
		failedPolicy      map[string]struct{}
		failedPolicyByKey map[string]models.ScanCompliancePolicy
	}

	accumulators := make(map[uuid.UUID]*summaryAccumulator, len(rows))
	for _, row := range rows {
		acc := accumulators[row.ScanID]
		if acc == nil {
			acc = &summaryAccumulator{
				summary: &models.ScanComplianceSummary{
					Status: "pass",
				},
				policies:          make(map[string]struct{}),
				failedPolicy:      make(map[string]struct{}),
				failedPolicyByKey: make(map[string]models.ScanCompliancePolicy),
			}
			accumulators[row.ScanID] = acc
		}

		if row.Status == "fail" {
			acc.summary.FailCount++
			acc.summary.Status = "fail"
		} else {
			acc.summary.PassCount++
		}

		if acc.summary.EvaluatedAt == nil || row.EvaluatedAt.After(*acc.summary.EvaluatedAt) {
			evaluatedAt := row.EvaluatedAt
			acc.summary.EvaluatedAt = &evaluatedAt
		}

		policyName := strings.TrimSpace(policyNames[row.PolicyID])
		if policyName == "" {
			continue
		}

		acc.policies[policyName] = struct{}{}
		if row.Status == "fail" {
			acc.failedPolicy[policyName] = struct{}{}
			if detail, ok := policyDetails[row.PolicyID]; ok {
				acc.failedPolicyByKey[policyName] = detail
			} else if _, exists := acc.failedPolicyByKey[policyName]; !exists {
				acc.failedPolicyByKey[policyName] = models.ScanCompliancePolicy{Name: policyName}
			}
		}
	}

	summaries := make(map[uuid.UUID]*models.ScanComplianceSummary, len(accumulators))
	for scanID, acc := range accumulators {
		acc.summary.PolicyNames = sortedStringSet(acc.policies)
		acc.summary.FailedPolicyNames = sortedStringSet(acc.failedPolicy)
		acc.summary.FailedPolicies = sortedFailedPolicies(acc.failedPolicyByKey)
		summaries[scanID] = acc.summary
	}

	return summaries
}

func sortedStringSet(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func sortedFailedPolicies(values map[string]models.ScanCompliancePolicy) []models.ScanCompliancePolicy {
	if len(values) == 0 {
		return nil
	}

	result := make([]models.ScanCompliancePolicy, 0, len(values))
	for _, value := range values {
		value.RuleSummaries = dedupeAndSortStrings(value.RuleSummaries)
		result = append(result, value)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Name < result[j].Name
	})
	return result
}

func dedupeAndSortStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	sort.Strings(result)
	return result
}

func summarizePolicyRules(rules models.PolicyRuleList) []string {
	if len(rules) == 0 {
		return nil
	}

	summaries := make([]string, 0, len(rules))
	for _, rule := range rules {
		summaries = append(summaries, summarizePolicyRule(rule))
	}
	return dedupeAndSortStrings(summaries)
}

func summarizePolicyRule(rule models.PolicyRule) string {
	switch rule.Type {
	case "max_cvss":
		return fmt.Sprintf("Max CVSS < %.1f", rule.Value)
	case "max_count":
		severity := strings.ToUpper(strings.TrimSpace(rule.Severity))
		if severity == "" {
			severity = "severity"
		}
		return fmt.Sprintf("Max %s vulnerabilities: %d", severity, int(rule.Value))
	case "max_total":
		return fmt.Sprintf("Max total vulnerabilities: %d", int(rule.Value))
	case "require_fix":
		severity := strings.ToUpper(strings.TrimSpace(rule.Severity))
		if severity == "" {
			severity = "specified"
		}
		return fmt.Sprintf("Fix required for %s vulnerabilities", severity)
	case "blocked_cve":
		cve := strings.TrimSpace(rule.CVEID)
		if cve == "" {
			cve = "specified CVE"
		}
		return fmt.Sprintf("Blocked CVE: %s", cve)
	case "xray_policy_block":
		return "No Xray policy blocking vulnerabilities"
	default:
		return rule.Type
	}
}
