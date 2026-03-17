package compliance

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

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
		}
	}

	status := "pass"
	if len(violations) > 0 {
		status = "fail"
	}
	return status, violations
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

	// Load all org_scans for this scan
	var orgScans []models.OrgScan
	if err := db.NewSelect().Model(&orgScans).Where("scan_id = ?", scanID).Scan(ctx); err != nil {
		log.Errorf("compliance: failed to load org assignments for scan %s: %v", scanID, err)
		return
	}

	for _, os := range orgScans {
		// Load policies for this org
		var policies []models.OrgPolicy
		if err := db.NewSelect().Model(&policies).Where("org_id = ?", os.OrgID).Scan(ctx); err != nil {
			continue
		}
		for _, policy := range policies {
			status, violations := EvaluatePolicy(&policy, vulns)
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
