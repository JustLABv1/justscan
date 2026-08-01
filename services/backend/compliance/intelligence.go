package compliance

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"justscan-backend/functions/authz"
	"justscan-backend/notifications"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

const (
	IntelligencePolicyStatusPass            = "pass"
	IntelligencePolicyStatusFail            = "fail"
	IntelligencePolicyStatusNeedsValidation = "needs_validation"

	IntelligencePolicyImpactResolved        = "resolved"
	IntelligencePolicyImpactNewFailure      = "new_failure"
	IntelligencePolicyImpactStillFailed     = "still_failed"
	IntelligencePolicyImpactNeedsValidation = "needs_validation"
)

// IntelligencePolicyEvaluation is the result of applying current intelligence
// to an otherwise immutable scan finding set. The changed fields are kept
// separate so callers can distinguish an intelligence-driven impact from a
// normal policy evaluation.
type IntelligencePolicyEvaluation struct {
	Status            string
	Violations        models.ViolationList
	NeedsValidation   bool
	ChangedFindingIDs []uuid.UUID
	ChangedCVEIDs     []string
	Reasons           []string
}

// IntelligencePolicyImpact is a scoped comparison between the original
// compliance result and the current intelligence overlay.
type IntelligencePolicyImpact struct {
	OrgID                uuid.UUID            `json:"org_id"`
	PolicyID             uuid.UUID            `json:"policy_id"`
	PolicyName           string               `json:"policy_name"`
	HistoricalStatus     string               `json:"historical_status"`
	CurrentStatus        string               `json:"current_status"`
	Impact               string               `json:"impact"`
	ChangedCVEs          []string             `json:"changed_cves"`
	ChangedFindingCount  int                  `json:"changed_finding_count"`
	HistoricalViolations models.ViolationList `json:"historical_violations"`
	CurrentViolations    models.ViolationList `json:"current_violations"`
	Reason               string               `json:"reason"`
	EvaluatedAt          time.Time            `json:"evaluated_at"`
}

// IntelligencePolicyImpactResponse is intentionally scan-scoped. It never
// contains installation-wide counts or policies outside the caller's scope.
type IntelligencePolicyImpactResponse struct {
	HasImpact      bool                       `json:"has_impact"`
	RescanRequired bool                       `json:"rescan_required"`
	Policies       []IntelligencePolicyImpact `json:"policies"`
}

// EvaluatePolicyWithCurrentIntelligence evaluates a policy against current
// posture values while retaining the original finding when intelligence is
// uncertain. Rejected and not-affected findings are excluded from the current
// view, but the caller remains responsible for preserving the historical
// compliance result.
func EvaluatePolicyWithCurrentIntelligence(
	policy *models.OrgPolicy,
	vulns []models.Vulnerability,
	changedFindingIDs map[uuid.UUID]struct{},
) IntelligencePolicyEvaluation {
	if policy == nil {
		return IntelligencePolicyEvaluation{Status: IntelligencePolicyStatusPass}
	}

	effective := make([]models.Vulnerability, 0, len(vulns))
	changedIDs := make([]uuid.UUID, 0)
	changedCVEs := make([]string, 0)
	reasons := make([]string, 0)
	seenChangedIDs := make(map[uuid.UUID]struct{})
	seenCVEs := make(map[string]struct{})
	seenReasons := make(map[string]struct{})
	needsValidation := false

	addChanged := func(vulnerability models.Vulnerability) {
		if _, ok := seenChangedIDs[vulnerability.ID]; !ok {
			seenChangedIDs[vulnerability.ID] = struct{}{}
			changedIDs = append(changedIDs, vulnerability.ID)
		}
		cve := strings.TrimSpace(vulnerability.VulnID)
		if cve != "" {
			if _, ok := seenCVEs[cve]; !ok {
				seenCVEs[cve] = struct{}{}
				changedCVEs = append(changedCVEs, cve)
			}
		}
	}
	addReason := func(reason string) {
		reason = strings.TrimSpace(reason)
		if reason == "" {
			return
		}
		if _, ok := seenReasons[reason]; ok {
			return
		}
		seenReasons[reason] = struct{}{}
		reasons = append(reasons, reason)
	}

	for _, vulnerability := range vulns {
		_, changed := changedFindingIDs[vulnerability.ID]
		posture := vulnerability.CurrentPosture
		if changed {
			addChanged(vulnerability)
		}

		if posture != nil && postureExcludesFinding(posture) {
			if changed {
				addReason(posture.Reason)
			}
			continue
		}

		effectiveVulnerability := vulnerability
		if posture != nil {
			overlayVulnerability(&effectiveVulnerability, posture)
			if changed && postureNeedsValidation(posture) {
				needsValidation = true
				addReason(posture.Reason)
			}
			if changed {
				addReason(posture.Reason)
			}
		}
		effective = append(effective, effectiveVulnerability)
	}

	status, violations := EvaluatePolicy(policy, effective)
	if needsValidation {
		status = IntelligencePolicyStatusNeedsValidation
	}

	sort.Slice(changedCVEs, func(i, j int) bool { return changedCVEs[i] < changedCVEs[j] })
	sort.Slice(reasons, func(i, j int) bool { return reasons[i] < reasons[j] })

	return IntelligencePolicyEvaluation{
		Status:            status,
		Violations:        violations,
		NeedsValidation:   needsValidation,
		ChangedFindingIDs: changedIDs,
		ChangedCVEIDs:     changedCVEs,
		Reasons:           reasons,
	}
}

func postureExcludesFinding(posture *models.VulnerabilityPosture) bool {
	if posture == nil {
		return false
	}
	return posture.State == models.PostureStateRejected ||
		posture.State == models.PostureStateNotAffected ||
		posture.CVEState == models.IntelligenceCVEStateRejected ||
		posture.CVEState == models.IntelligenceCVEStateNotAffected
}

func postureNeedsValidation(posture *models.VulnerabilityPosture) bool {
	if posture == nil {
		return false
	}
	return posture.State == models.PostureStateDisputed ||
		posture.State == models.PostureStateNeedsRescan ||
		posture.CVEState == models.IntelligenceCVEStateDisputed ||
		posture.CVEState == models.IntelligenceCVEStateUnknown ||
		len(posture.ConflictSources) > 0
}

func overlayVulnerability(vulnerability *models.Vulnerability, posture *models.VulnerabilityPosture) {
	if vulnerability == nil || posture == nil {
		return
	}
	if severity := strings.TrimSpace(posture.Severity); severity != "" && !strings.EqualFold(severity, models.SeverityUnknown) {
		vulnerability.Severity = severity
	}
	if posture.CVSSScore > 0 {
		vulnerability.CVSSScore = posture.CVSSScore
	}
	if vector := strings.TrimSpace(posture.CVSSVector); vector != "" {
		vulnerability.CVSSVector = vector
	}
	if len(posture.FixedVersions) > 0 {
		vulnerability.FixedVersion = strings.Join(posture.FixedVersions, ", ")
	} else if posture.State == models.PostureStateFixAvailable || posture.CVEState == models.IntelligenceCVEStateAffected {
		vulnerability.FixedVersion = ""
	}
}

// EvaluateScanIntelligencePolicyImpacts evaluates only compliance policies
// visible to the caller. A nil visibleOrgIDs slice is reserved for trusted
// internal callers and means all organizations.
func EvaluateScanIntelligencePolicyImpacts(
	ctx context.Context,
	db *bun.DB,
	scanID uuid.UUID,
	visibleOrgIDs []uuid.UUID,
	isAdmin bool,
) (IntelligencePolicyImpactResponse, error) {
	scan, err := loadScanForPolicyImpact(ctx, db, scanID)
	if err != nil {
		return IntelligencePolicyImpactResponse{}, err
	}
	if scan.Status != models.ScanStatusCompleted {
		return IntelligencePolicyImpactResponse{Policies: []IntelligencePolicyImpact{}}, nil
	}

	vulns, changed, err := loadCurrentPolicyImpactVulnerabilities(ctx, db, scan, nil)
	if err != nil {
		return IntelligencePolicyImpactResponse{}, err
	}
	return evaluateScanPolicyImpacts(ctx, db, scan, vulns, changed, visibleOrgIDs, isAdmin)
}

func evaluateScanPolicyImpacts(
	ctx context.Context,
	db *bun.DB,
	scan *models.Scan,
	vulns []models.Vulnerability,
	changed map[uuid.UUID]models.IntelligencePostureChange,
	visibleOrgIDs []uuid.UUID,
	isAdmin bool,
) (IntelligencePolicyImpactResponse, error) {
	response := IntelligencePolicyImpactResponse{Policies: []IntelligencePolicyImpact{}}
	if scan == nil || len(changed) == 0 {
		return response, nil
	}
	if !isAdmin && len(visibleOrgIDs) == 0 {
		return response, nil
	}

	var results []models.ComplianceResult
	if err := db.NewSelect().Model(&results).Where("scan_id = ?", scan.ID).OrderExpr("org_id ASC, policy_id ASC").Scan(ctx); err != nil {
		return response, fmt.Errorf("load compliance results for intelligence impact: %w", err)
	}

	visible := make(map[uuid.UUID]struct{}, len(visibleOrgIDs))
	for _, orgID := range visibleOrgIDs {
		visible[orgID] = struct{}{}
	}

	policyIDs := make([]uuid.UUID, 0, len(results))
	seenPolicyIDs := make(map[uuid.UUID]struct{})
	for _, result := range results {
		if !isAdmin {
			if _, ok := visible[result.OrgID]; !ok {
				continue
			}
		}
		if _, ok := seenPolicyIDs[result.PolicyID]; ok {
			continue
		}
		seenPolicyIDs[result.PolicyID] = struct{}{}
		policyIDs = append(policyIDs, result.PolicyID)
	}
	if len(policyIDs) == 0 {
		return response, nil
	}

	var policies []models.OrgPolicy
	if err := db.NewSelect().Model(&policies).Where("id IN (?)", bun.In(policyIDs)).Scan(ctx); err != nil {
		return response, fmt.Errorf("load policies for intelligence impact: %w", err)
	}
	policiesByID := make(map[uuid.UUID]*models.OrgPolicy, len(policies))
	for i := range policies {
		policiesByID[policies[i].ID] = &policies[i]
	}

	unsuppressedByOrg := make(map[uuid.UUID][]models.Vulnerability)
	for _, result := range results {
		if !isAdmin {
			if _, ok := visible[result.OrgID]; !ok {
				continue
			}
		}
		policy := policiesByID[result.PolicyID]
		if policy == nil {
			continue
		}

		evaluationVulns := vulns
		if !policy.IncludeSuppressed {
			filtered, ok := unsuppressedByOrg[result.OrgID]
			if !ok {
				var filterErr error
				filtered, filterErr = filterSuppressedVulnerabilitiesForOrg(ctx, db, scan, result.OrgID, vulns)
				if filterErr != nil {
					return response, fmt.Errorf("filter policy findings for intelligence impact: %w", filterErr)
				}
				unsuppressedByOrg[result.OrgID] = filtered
			}
			evaluationVulns = filtered
		}

		changedForPolicy := make(map[uuid.UUID]struct{}, len(changed))
		for _, vulnerability := range evaluationVulns {
			if _, ok := changed[vulnerability.ID]; ok {
				changedForPolicy[vulnerability.ID] = struct{}{}
			}
		}
		if len(changedForPolicy) == 0 {
			continue
		}

		evaluation := EvaluatePolicyWithCurrentIntelligence(policy, evaluationVulns, changedForPolicy)
		intelligenceAffected := changedFindingsAffectPolicy(policy, evaluationVulns, changedForPolicy, result.Violations, evaluation.Violations)
		impact, material := classifyPolicyImpact(result.Status, evaluation.Status, result.Violations, evaluation.Violations, evaluation.NeedsValidation, intelligenceAffected)
		if !material {
			continue
		}

		changedCVEs := make([]string, 0, len(changedForPolicy))
		seenCVEs := make(map[string]struct{})
		reasons := append([]string{}, evaluation.Reasons...)
		for findingID := range changedForPolicy {
			change := changed[findingID]
			if cve := strings.TrimSpace(change.VulnID); cve != "" {
				if _, ok := seenCVEs[cve]; !ok {
					seenCVEs[cve] = struct{}{}
					changedCVEs = append(changedCVEs, cve)
				}
			}
			if reason := strings.TrimSpace(change.Reason); reason != "" {
				reasons = append(reasons, reason)
			}
		}
		sort.Strings(changedCVEs)
		reasons = uniqueSortedStrings(reasons)

		policyName := strings.TrimSpace(policy.Name)
		if policyName == "" {
			policyName = policy.ID.String()
		}
		response.Policies = append(response.Policies, IntelligencePolicyImpact{
			OrgID:                result.OrgID,
			PolicyID:             result.PolicyID,
			PolicyName:           policyName,
			HistoricalStatus:     result.Status,
			CurrentStatus:        evaluation.Status,
			Impact:               impact,
			ChangedCVEs:          changedCVEs,
			ChangedFindingCount:  len(changedForPolicy),
			HistoricalViolations: nonNilViolations(result.Violations),
			CurrentViolations:    nonNilViolations(evaluation.Violations),
			Reason:               policyImpactReason(impact, reasons),
			EvaluatedAt:          time.Now().UTC(),
		})
	}

	sort.Slice(response.Policies, func(i, j int) bool {
		if response.Policies[i].OrgID != response.Policies[j].OrgID {
			return response.Policies[i].OrgID.String() < response.Policies[j].OrgID.String()
		}
		return response.Policies[i].PolicyID.String() < response.Policies[j].PolicyID.String()
	})
	response.HasImpact = len(response.Policies) > 0
	response.RescanRequired = response.HasImpact
	return response, nil
}

func classifyPolicyImpact(historicalStatus, currentStatus string, historical, current models.ViolationList, needsValidation, intelligenceAffected bool) (string, bool) {
	if needsValidation || currentStatus == IntelligencePolicyStatusNeedsValidation {
		return IntelligencePolicyImpactNeedsValidation, true
	}
	historicalStatus = strings.ToLower(strings.TrimSpace(historicalStatus))
	currentStatus = strings.ToLower(strings.TrimSpace(currentStatus))
	switch {
	case historicalStatus == IntelligencePolicyStatusFail && currentStatus == IntelligencePolicyStatusPass:
		return IntelligencePolicyImpactResolved, true
	case historicalStatus == IntelligencePolicyStatusPass && currentStatus == IntelligencePolicyStatusFail:
		return IntelligencePolicyImpactNewFailure, true
	case historicalStatus == IntelligencePolicyStatusFail && currentStatus == IntelligencePolicyStatusFail && (violationListsDiffer(historical, current) || intelligenceAffected):
		return IntelligencePolicyImpactStillFailed, true
	default:
		return "", false
	}
}

func changedFindingsAffectPolicy(
	policy *models.OrgPolicy,
	vulns []models.Vulnerability,
	changed map[uuid.UUID]struct{},
	historical models.ViolationList,
	current models.ViolationList,
) bool {
	if policy == nil || len(changed) == 0 {
		return false
	}
	for _, rule := range policy.Rules {
		if rule.Type == "max_count" || rule.Type == "max_total" {
			return true
		}
	}

	changedCVEs := make(map[string]struct{}, len(changed))
	for _, vulnerability := range vulns {
		if _, ok := changed[vulnerability.ID]; ok && strings.TrimSpace(vulnerability.VulnID) != "" {
			changedCVEs[vulnerability.VulnID] = struct{}{}
		}
	}
	if len(changedCVEs) == 0 {
		return false
	}
	for _, violation := range append(append(models.ViolationList{}, historical...), current...) {
		if _, ok := changedCVEs[violation.VulnID]; ok {
			return true
		}
	}
	return false
}

func violationListsDiffer(left, right models.ViolationList) bool {
	return violationSignatures(left) != violationSignatures(right)
}

func violationSignatures(violations models.ViolationList) string {
	values := make([]string, 0, len(violations))
	for _, violation := range violations {
		encoded, err := json.Marshal(violation)
		if err != nil {
			values = append(values, violation.Message+"\x00"+violation.VulnID)
			continue
		}
		values = append(values, string(encoded))
	}
	sort.Strings(values)
	return strings.Join(values, "\x00")
}

func policyImpactReason(impact string, reasons []string) string {
	if len(reasons) > 0 {
		return strings.Join(reasons, " ")
	}
	switch impact {
	case IntelligencePolicyImpactResolved:
		return "Current intelligence no longer produces a policy violation. A new scan is required to make this authoritative."
	case IntelligencePolicyImpactNewFailure:
		return "Current intelligence produces a new policy violation. A new scan is required to make this authoritative."
	case IntelligencePolicyImpactStillFailed:
		return "Current intelligence changed the policy inputs, but the policy still fails."
	default:
		return "Current intelligence needs validation before the policy result can be trusted."
	}
}

func uniqueSortedStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func nonNilViolations(violations models.ViolationList) models.ViolationList {
	if violations == nil {
		return models.ViolationList{}
	}
	return violations
}

func loadScanForPolicyImpact(ctx context.Context, db *bun.DB, scanID uuid.UUID) (*models.Scan, error) {
	scan := &models.Scan{}
	if err := db.NewSelect().Model(scan).Where("id = ?", scanID).Scan(ctx); err != nil {
		return nil, fmt.Errorf("load scan for intelligence policy impact: %w", err)
	}
	return scan, nil
}

func loadCurrentPolicyImpactVulnerabilities(
	ctx context.Context,
	db *bun.DB,
	scan *models.Scan,
	override map[uuid.UUID]models.IntelligencePostureChange,
) ([]models.Vulnerability, map[uuid.UUID]models.IntelligencePostureChange, error) {
	var vulns []models.Vulnerability
	if err := db.NewSelect().Model(&vulns).Where("scan_id = ?", scan.ID).OrderExpr("id ASC").Scan(ctx); err != nil {
		return nil, nil, fmt.Errorf("load scan findings for intelligence policy impact: %w", err)
	}

	var postures []models.VulnerabilityPosture
	if len(vulns) > 0 {
		findingIDs := make([]uuid.UUID, 0, len(vulns))
		for _, vulnerability := range vulns {
			findingIDs = append(findingIDs, vulnerability.ID)
		}
		if err := db.NewSelect().Model(&postures).Where("finding_id IN (?)", bun.In(findingIDs)).Scan(ctx); err != nil {
			return nil, nil, fmt.Errorf("load current postures for intelligence policy impact: %w", err)
		}
	}

	postureByFinding := make(map[uuid.UUID]*models.VulnerabilityPosture, len(postures))
	for i := range postures {
		postureByFinding[postures[i].FindingID] = &postures[i]
	}
	changed := make(map[uuid.UUID]models.IntelligencePostureChange)
	if override != nil {
		for findingID, change := range override {
			changed[findingID] = change
		}
	}
	for i := range vulns {
		vulnerability := &vulns[i]
		vulnerability.CurrentPosture = postureByFinding[vulnerability.ID]
		if override != nil {
			continue
		}
		posture := postureByFinding[vulnerability.ID]
		if !postScanPostureChange(scan, posture) {
			continue
		}
		changed[vulnerability.ID] = models.IntelligencePostureChange{
			FindingID:     vulnerability.ID,
			ScanID:        scan.ID,
			VulnID:        vulnerability.VulnID,
			State:         posture.State,
			Reason:        posture.Reason,
			ChangeEventID: posture.ChangeEventID,
		}
	}
	return vulns, changed, nil
}

func postScanPostureChange(scan *models.Scan, posture *models.VulnerabilityPosture) bool {
	if scan == nil || posture == nil {
		return false
	}
	if posture.ChangeEventID != nil {
		return true
	}
	return scan.CompletedAt != nil && posture.ObservedAt.After(scan.CompletedAt.UTC())
}

// ProcessIntelligencePolicyImpacts projects a batch of refreshed posture
// changes into notification events. It is safe to run asynchronously because
// the scan endpoint derives the current impact directly from durable posture
// data and this function never mutates the historical compliance result.
func ProcessIntelligencePolicyImpacts(ctx context.Context, db *bun.DB, changes []models.IntelligencePostureChange) error {
	if db == nil || len(changes) == 0 {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	byScan := make(map[uuid.UUID]map[uuid.UUID]models.IntelligencePostureChange)
	for _, change := range changes {
		if change.ScanID == uuid.Nil || change.FindingID == uuid.Nil {
			continue
		}
		if byScan[change.ScanID] == nil {
			byScan[change.ScanID] = make(map[uuid.UUID]models.IntelligencePostureChange)
		}
		byScan[change.ScanID][change.FindingID] = change
	}

	for scanID, scanChanges := range byScan {
		scan, err := loadScanForPolicyImpact(ctx, db, scanID)
		if err != nil {
			return err
		}
		if scan.Status != models.ScanStatusCompleted {
			continue
		}
		vulns, _, err := loadCurrentPolicyImpactVulnerabilities(ctx, db, scan, scanChanges)
		if err != nil {
			return err
		}
		response, err := evaluateScanPolicyImpacts(ctx, db, scan, vulns, scanChanges, nil, true)
		if err != nil {
			return err
		}
		if !response.HasImpact {
			continue
		}
		if err := dispatchIntelligencePolicyImpactNotifications(ctx, db, scan, response, scanChanges); err != nil {
			return err
		}
	}
	return nil
}

func dispatchIntelligencePolicyImpactNotifications(
	ctx context.Context,
	db *bun.DB,
	scan *models.Scan,
	response IntelligencePolicyImpactResponse,
	changes map[uuid.UUID]models.IntelligencePostureChange,
) error {
	userIDs, _, err := intelligenceImpactRecipients(ctx, db, scan, response.Policies)
	if err != nil {
		return err
	}

	byImpact := make(map[string][]IntelligencePolicyImpact)
	for _, impact := range response.Policies {
		byImpact[impact.Impact] = append(byImpact[impact.Impact], impact)
	}
	for impactName, impacts := range byImpact {
		policyIDs := make([]string, 0, len(impacts))
		policyNames := make([]string, 0, len(impacts))
		changedCVEs := make([]string, 0)
		orgIDStrings := make([]string, 0)
		historicalStatuses := make([]string, 0, len(impacts))
		currentStatuses := make([]string, 0, len(impacts))
		seenPolicies := make(map[string]struct{})
		seenCVEs := make(map[string]struct{})
		seenOrgs := make(map[string]struct{})
		changedFindingCount := 0
		reasons := make([]string, 0)
		for _, impact := range impacts {
			if _, ok := seenPolicies[impact.PolicyID.String()]; !ok {
				seenPolicies[impact.PolicyID.String()] = struct{}{}
				policyIDs = append(policyIDs, impact.PolicyID.String())
				policyNames = append(policyNames, impact.PolicyName)
			}
			if scan.OwnerOrgID != nil {
				if _, ok := seenOrgs[impact.OrgID.String()]; !ok {
					seenOrgs[impact.OrgID.String()] = struct{}{}
					orgIDStrings = append(orgIDStrings, impact.OrgID.String())
				}
			}
			for _, cve := range impact.ChangedCVEs {
				if _, ok := seenCVEs[cve]; ok {
					continue
				}
				seenCVEs[cve] = struct{}{}
				changedCVEs = append(changedCVEs, cve)
			}
			historicalStatuses = append(historicalStatuses, impact.HistoricalStatus)
			currentStatuses = append(currentStatuses, impact.CurrentStatus)
			changedFindingCount += impact.ChangedFindingCount
			if impact.Reason != "" {
				reasons = append(reasons, impact.Reason)
			}
		}
		sort.Strings(policyIDs)
		sort.Strings(policyNames)
		sort.Strings(changedCVEs)
		sort.Strings(orgIDStrings)
		reasons = uniqueSortedStrings(reasons)
		dedupeKey := intelligencePolicyImpactDedupeKey(scan.ID, impactName, changes)
		historicalStatus := combinedStatus(historicalStatuses)
		currentStatus := combinedStatus(currentStatuses)
		details := fmt.Sprintf(
			"Current CVE intelligence changed %d finding(s) across %s. Historical policy status: %s; current intelligence status: %s. A new scan is required to make this authoritative.",
			changedFindingCount,
			strings.Join(policyNames, ", "),
			historicalStatus,
			currentStatus,
		)
		if len(reasons) > 0 {
			details += " " + strings.Join(reasons, " ")
		}
		if len(changedCVEs) > 0 {
			details += " Changed CVEs: " + strings.Join(changedCVEs, ", ") + "."
		}

		notifications.Dispatch(db, models.NotificationEventIntelligencePolicyImpact, notifications.Payload{
			ScanID:                     scan.ID.String(),
			OrgIDs:                     orgIDStrings,
			UserIDs:                    userIDs,
			PolicyIDs:                  policyIDs,
			PolicyNames:                policyNames,
			ChangedCVEs:                changedCVEs,
			HistoricalComplianceStatus: historicalStatus,
			CurrentComplianceStatus:    currentStatus,
			IntelligenceImpact:         impactName,
			RescanRequired:             true,
			ComplianceStatus:           currentStatus,
			ComplianceFailed:           currentStatus == IntelligencePolicyStatusFail,
			Details:                    details,
			DedupeKey:                  dedupeKey,
			Extra: map[string]string{
				"impact":            impactName,
				"rescan_required":   "true",
				"historical_status": historicalStatus,
				"current_status":    currentStatus,
			},
		})
	}
	return nil
}

func intelligencePolicyImpactDedupeKey(scanID uuid.UUID, impact string, changes map[uuid.UUID]models.IntelligencePostureChange) string {
	changeKeys := make([]string, 0, len(changes))
	for findingID, change := range changes {
		key := findingID.String()
		if change.PostureEventID != uuid.Nil {
			key = change.PostureEventID.String()
		} else if change.ChangeEventID != nil {
			key = change.ChangeEventID.String()
		}
		changeKeys = append(changeKeys, key)
	}
	sort.Strings(changeKeys)
	if len(changeKeys) == 0 {
		changeKeys = []string{"current"}
	}
	return "intelligence_policy_impact:" + scanID.String() + ":" + impact + ":" + strings.Join(changeKeys, ",")
}

func combinedStatus(values []string) string {
	unique := uniqueSortedStrings(values)
	if len(unique) == 1 {
		return unique[0]
	}
	if len(unique) == 0 {
		return IntelligencePolicyStatusPass
	}
	return "mixed"
}

func intelligenceImpactRecipients(ctx context.Context, db *bun.DB, scan *models.Scan, impacts []IntelligencePolicyImpact) ([]string, []string, error) {
	userSet := make(map[string]struct{})
	orgSet := make(map[string]struct{})
	if scan.OwnerOrgID == nil {
		owner := scan.OwnerUserID
		if owner == nil {
			owner = scan.UserID
		}
		if owner != nil {
			userSet[owner.String()] = struct{}{}
		}
	}
	if scan.OwnerOrgID != nil {
		for _, impact := range impacts {
			orgSet[impact.OrgID.String()] = struct{}{}
		}
	}

	orgIDs := make([]uuid.UUID, 0, len(orgSet))
	for orgID := range orgSet {
		parsed, err := uuid.Parse(orgID)
		if err == nil {
			orgIDs = append(orgIDs, parsed)
		}
	}
	if len(orgIDs) > 0 {
		var members []models.OrgMember
		if err := db.NewSelect().Model(&members).
			Where("org_id IN (?)", bun.In(orgIDs)).
			Where("role IN (?)", bun.In([]string{models.OrgRoleOwner, models.OrgRoleAdmin})).
			Scan(ctx); err != nil {
			return nil, nil, fmt.Errorf("load intelligence policy impact organization admins: %w", err)
		}
		for _, member := range members {
			userSet[member.UserID.String()] = struct{}{}
		}

		var orgs []models.Org
		if err := db.NewSelect().Model(&orgs).Column("id", "created_by_id").Where("id IN (?)", bun.In(orgIDs)).Scan(ctx); err != nil && err != sql.ErrNoRows {
			return nil, nil, fmt.Errorf("load intelligence policy impact organization owners: %w", err)
		}
		for _, org := range orgs {
			if org.CreatedByID != uuid.Nil {
				userSet[org.CreatedByID.String()] = struct{}{}
			}
		}
	}

	userIDs := make([]string, 0, len(userSet))
	for userID := range userSet {
		userIDs = append(userIDs, userID)
	}
	orgIDStrings := make([]string, 0, len(orgSet))
	for orgID := range orgSet {
		orgIDStrings = append(orgIDStrings, orgID)
	}
	sort.Strings(userIDs)
	sort.Strings(orgIDStrings)
	return userIDs, orgIDStrings, nil
}

// LoadVisibleOrgIDs is a small shared authorization helper for handlers that
// need to pass the same compliance scope into an intelligence calculation.
func LoadVisibleOrgIDs(ctx context.Context, db *bun.DB, userID uuid.UUID, isAdmin bool) ([]uuid.UUID, error) {
	return authz.ListAccessibleOrgIDs(ctx, db, userID, isAdmin)
}
