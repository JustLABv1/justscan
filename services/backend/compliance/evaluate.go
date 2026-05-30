package compliance

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	effectivesuppressions "justscan-backend/functions/suppressions"
	"justscan-backend/notifications"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// EvaluatePolicy runs a policy's rules against a list of vulnerabilities.
func EvaluatePolicy(policy *models.OrgPolicy, vulns []models.Vulnerability) (string, models.ViolationList) {
	var violations models.ViolationList

	for _, rule := range policy.Rules {
		switch rule.Type {
		case "max_cvss":
			for _, v := range vulns {
				if v.CVSSScore > 0 && v.CVSSScore >= rule.Value {
					violations = append(violations, models.Violation{
						Rule:    rule,
						Message: fmt.Sprintf("%s has CVSS %.1f (max allowed: < %.1f)", v.VulnID, v.CVSSScore, rule.Value),
						VulnID:  v.VulnID,
					})
				}
			}
		case "max_count":
			count := 0
			for _, v := range vulns {
				if strings.EqualFold(v.Severity, rule.Severity) {
					count++
				}
			}
			if float64(count) > rule.Value {
				violations = append(violations, models.Violation{
					Rule:    rule,
					Message: fmt.Sprintf("%d %s vulnerabilities found (max allowed: %d)", count, strings.ToUpper(rule.Severity), int(rule.Value)),
				})
			}
		case "max_total":
			if float64(len(vulns)) > rule.Value {
				violations = append(violations, models.Violation{
					Rule:    rule,
					Message: fmt.Sprintf("%d total vulnerabilities (max allowed: %d)", len(vulns), int(rule.Value)),
				})
			}
		case "require_fix":
			for _, v := range vulns {
				if strings.EqualFold(v.Severity, rule.Severity) && v.FixedVersion == "" {
					violations = append(violations, models.Violation{
						Rule:    rule,
						Message: fmt.Sprintf("%s (%s) has no fix available", v.VulnID, strings.ToUpper(rule.Severity)),
						VulnID:  v.VulnID,
					})
				}
			}
		case "blocked_cve":
			for _, v := range vulns {
				if strings.EqualFold(v.VulnID, rule.CVEID) {
					violations = append(violations, models.Violation{
						Rule:    rule,
						Message: fmt.Sprintf("Blocked CVE %s is present in %s", rule.CVEID, v.PkgName),
						VulnID:  v.VulnID,
					})
				}
			}
		case "xray_policy_block":
			for _, v := range vulns {
				if !v.XrayIsBlocking {
					continue
				}
				details := ""
				if len(v.XrayWatchNames) > 0 {
					details = fmt.Sprintf(" (watches: %s)", strings.Join(v.XrayWatchNames, ", "))
				}
				violations = append(violations, models.Violation{
					Rule:    rule,
					Message: fmt.Sprintf("%s (%s) is blocked by Xray policy%s", v.VulnID, v.PkgName, details),
					VulnID:  v.VulnID,
				})
			}
		}
	}

	status := "pass"
	if len(violations) > 0 {
		status = "fail"
	}
	return status, violations
}

func filterSuppressedVulnerabilitiesForOrg(
	ctx context.Context,
	db *bun.DB,
	scan *models.Scan,
	orgID uuid.UUID,
	vulns []models.Vulnerability,
) ([]models.Vulnerability, error) {
	localByVuln, err := effectivesuppressions.LoadLocalSuppressionsByDigest(
		ctx,
		db,
		scan.ImageDigest,
		nil,
		[]uuid.UUID{orgID},
	)
	if err != nil {
		return nil, err
	}

	xrayByVuln := map[string]*models.XraySuppression{}
	if scan.ScanProvider == models.ScanProviderArtifactoryXray {
		xrayByVuln, err = effectivesuppressions.LoadXraySuppressionsByScan(ctx, db, scan.ID)
		if err != nil {
			return nil, err
		}
	}

	return filterSuppressedVulnerabilities(vulns, localByVuln, xrayByVuln), nil
}

func filterSuppressedVulnerabilities(
	vulns []models.Vulnerability,
	localByVuln map[string]*models.Suppression,
	xrayByVuln map[string]*models.XraySuppression,
) []models.Vulnerability {
	filtered := make([]models.Vulnerability, 0, len(vulns))
	for i := range vulns {
		if effectivesuppressions.MergeEffectiveSuppression(localByVuln[vulns[i].VulnID], xrayByVuln[vulns[i].VulnID]) != nil {
			continue
		}
		filtered = append(filtered, vulns[i])
	}
	return filtered
}

// RunForScan loads all orgs this scan belongs to, evaluates every policy, and upserts compliance_results.
func RunForScan(db *bun.DB, scanID uuid.UUID) {
	ctx := context.Background()

	// Load vulnerabilities for this scan
	var vulns []models.Vulnerability
	if err := db.NewSelect().Model(&vulns).Where("scan_id = ?", scanID).Scan(ctx); err != nil {
		log.Errorf("compliance: failed to load vulns for scan %s: %v", scanID, err)
		return
	}

	scan := &models.Scan{}
	if err := db.NewSelect().Model(scan).Where("id = ?", scanID).Scan(ctx); err != nil {
		log.Warnf("compliance: failed to load scan %s for notification enrichment: %v", scanID, err)
		scan = &models.Scan{}
	}

	// Load all org_scans for this scan
	var orgScans []models.OrgScan
	if err := db.NewSelect().Model(&orgScans).Where("scan_id = ?", scanID).Scan(ctx); err != nil {
		log.Errorf("compliance: failed to load org assignments for scan %s: %v", scanID, err)
		return
	}

	orgNamesByID := make(map[uuid.UUID]string, len(orgScans))
	if len(orgScans) > 0 {
		orgIDs := make([]uuid.UUID, 0, len(orgScans))
		for _, orgScan := range orgScans {
			orgIDs = append(orgIDs, orgScan.OrgID)
		}
		var orgs []models.Org
		if err := db.NewSelect().
			Model(&orgs).
			Column("id", "name").
			Where("id IN (?)", bun.In(orgIDs)).
			Scan(ctx); err == nil {
			for _, org := range orgs {
				orgNamesByID[org.ID] = org.Name
			}
		}
	}

	for _, os := range orgScans {
		// Load policies for this org
		var policies []models.OrgPolicy
		if err := db.NewSelect().Model(&policies).Where("org_id = ?", os.OrgID).Scan(ctx); err != nil {
			continue
		}

		unsuppressedVulns := vulns
		unsuppressedLoaded := false
		for _, policy := range policies {
			evaluationVulns := vulns
			if !policy.IncludeSuppressed {
				if !unsuppressedLoaded {
					filteredVulns, filterErr := filterSuppressedVulnerabilitiesForOrg(ctx, db, scan, os.OrgID, vulns)
					if filterErr != nil {
						log.Errorf("compliance: failed to filter suppressions for scan %s org %s: %v", scanID, os.OrgID, filterErr)
					} else {
						unsuppressedVulns = filteredVulns
					}
					unsuppressedLoaded = true
				}
				evaluationVulns = unsuppressedVulns
			}

			status, violations := EvaluatePolicy(&policy, evaluationVulns)
			result := &models.ComplianceResult{
				ScanID:      scanID,
				PolicyID:    policy.ID,
				OrgID:       os.OrgID,
				Status:      status,
				Violations:  violations,
				EvaluatedAt: time.Now(),
			}
			// Upsert: delete old result for this scan+policy, insert new
			db.NewDelete().Model((*models.ComplianceResult)(nil)).
				Where("scan_id = ? AND policy_id = ?", scanID, policy.ID).
				Exec(ctx) //nolint:errcheck
			if _, err := db.NewInsert().Model(result).Exec(ctx); err != nil {
				log.Errorf("compliance: failed to store result for scan %s policy %s: %v", scanID, policy.ID, err)
			}
			// Record history entry
			history := &models.ComplianceHistory{
				ScanID:      scanID,
				PolicyID:    policy.ID,
				OrgID:       os.OrgID,
				Status:      status,
				EvaluatedAt: time.Now(),
			}
			db.NewInsert().Model(history).Exec(ctx) //nolint:errcheck
			if status == "fail" {
				orgLabel := strings.TrimSpace(orgNamesByID[os.OrgID])
				if orgLabel == "" {
					orgLabel = os.OrgID.String()
				}
				notifications.Dispatch(db, models.NotificationEventComplianceFailed, notifications.Payload{
					ScanID:           scanID.String(),
					ImageName:        scan.ImageName,
					ImageTag:         scan.ImageTag,
					OrgIDs:           []string{os.OrgID.String()},
					Status:           status,
					ComplianceStatus: status,
					ComplianceFailed: true,
					PolicyIDs:        []string{policy.ID.String()},
					PolicyNames:      []string{policy.Name},
					Details:          fmt.Sprintf("Policy %s failed for %s with %d violation(s).", policy.Name, orgLabel, len(violations)),
					Extra: map[string]string{
						"org_id":      os.OrgID.String(),
						"org_name":    orgLabel,
						"policy_id":   policy.ID.String(),
						"policy_name": policy.Name,
					},
				})
			}
		}
	}
}

// AutoAssignOrgs checks all orgs with image_patterns and auto-assigns the scan if it matches,
// then runs compliance evaluation for all orgs the scan belongs to.
func AutoAssignOrgs(db *bun.DB, imageName, imageTag string, scanID uuid.UUID) {
	ctx := context.Background()

	var orgs []models.Org
	if err := db.NewSelect().Model(&orgs).
		Where("jsonb_array_length(image_patterns) > 0").
		Scan(ctx); err != nil {
		RunForScan(db, scanID)
		return
	}

	imageRef := imageName + ":" + imageTag
	for _, org := range orgs {
		for _, pattern := range org.ImagePatterns {
			if matchPattern(pattern, imageRef) || matchPattern(pattern, imageName) {
				orgScan := &models.OrgScan{OrgID: org.ID, ScanID: scanID}
				db.NewInsert().Model(orgScan).On("CONFLICT DO NOTHING").Exec(ctx) //nolint:errcheck
				log.Infof("compliance: auto-assigned scan %s to org %s via pattern %q", scanID, org.Name, pattern)
				break
			}
		}
	}
	// Now run compliance for all orgs this scan is in
	RunForScan(db, scanID)
}

func matchPattern(pattern, target string) bool {
	// Convert glob pattern to regex: escape dots, * → .*, ? → .
	var sb strings.Builder
	sb.WriteString("(?i)^")
	for _, ch := range pattern {
		switch ch {
		case '*':
			sb.WriteString(".*")
		case '?':
			sb.WriteString(".")
		case '.', '+', '(', ')', '[', ']', '{', '}', '^', '$', '|', '\\':
			sb.WriteString(`\`)
			sb.WriteRune(ch)
		default:
			sb.WriteRune(ch)
		}
	}
	sb.WriteString("$")
	re, err := regexp.Compile(sb.String())
	if err != nil {
		return pattern == target
	}
	return re.MatchString(target)
}
