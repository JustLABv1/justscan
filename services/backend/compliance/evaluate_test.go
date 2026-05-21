package compliance

import (
	"testing"

	"justscan-backend/pkg/models"
)

func TestEvaluatePolicyXrayPolicyBlockFailsForBlockingVulnerability(t *testing.T) {
	policy := &models.OrgPolicy{
		Rules: models.PolicyRuleList{
			{Type: "xray_policy_block"},
		},
	}
	vulns := []models.Vulnerability{
		{
			VulnID:         "CVE-2026-1234",
			PkgName:        "openssl",
			XrayIsBlocking: true,
			XrayWatchNames: []string{"critical-watch"},
		},
	}

	status, violations := EvaluatePolicy(policy, vulns)
	if status != "fail" {
		t.Fatalf("expected fail status, got %q", status)
	}
	if len(violations) != 1 {
		t.Fatalf("expected 1 violation, got %d", len(violations))
	}
	if violations[0].VulnID != "CVE-2026-1234" {
		t.Fatalf("expected violation vuln_id to be set, got %q", violations[0].VulnID)
	}
}

func TestEvaluatePolicyXrayPolicyBlockPassesWhenNoBlockingMatches(t *testing.T) {
	policy := &models.OrgPolicy{
		Rules: models.PolicyRuleList{
			{Type: "xray_policy_block"},
		},
	}
	vulns := []models.Vulnerability{
		{
			VulnID:         "CVE-2026-0001",
			PkgName:        "zlib",
			XrayIsBlocking: false,
		},
	}

	status, violations := EvaluatePolicy(policy, vulns)
	if status != "pass" {
		t.Fatalf("expected pass status, got %q", status)
	}
	if len(violations) != 0 {
		t.Fatalf("expected no violations, got %d", len(violations))
	}
}

func TestPolicyIncludeSuppressedTrueStillFailsOnSuppressedVulnerability(t *testing.T) {
	policy := &models.OrgPolicy{
		IncludeSuppressed: true,
		Rules: models.PolicyRuleList{
			{Type: "max_cvss", Value: 8},
		},
	}
	vulns := []models.Vulnerability{
		{VulnID: "CVE-2026-31789", PkgName: "openssl", CVSSScore: 9.8},
	}

	filtered := filterSuppressedVulnerabilities(
		vulns,
		map[string]*models.Suppression{
			"CVE-2026-31789": {VulnID: "CVE-2026-31789"},
		},
		map[string]*models.XraySuppression{},
	)
	if len(filtered) != 0 {
		t.Fatalf("expected suppression-aware filtered list to be empty, got %d vulnerabilities", len(filtered))
	}

	status, violations := EvaluatePolicy(policy, vulns)
	if status != "fail" {
		t.Fatalf("expected fail status, got %q", status)
	}
	if len(violations) != 1 {
		t.Fatalf("expected 1 violation, got %d", len(violations))
	}
}

func TestPolicyExcludeSuppressedPassesWhenOnlyViolationsSuppressed(t *testing.T) {
	policy := &models.OrgPolicy{
		IncludeSuppressed: false,
		Rules: models.PolicyRuleList{
			{Type: "max_cvss", Value: 8},
		},
	}
	vulns := []models.Vulnerability{
		{VulnID: "CVE-2026-31789", PkgName: "openssl", CVSSScore: 9.8},
	}
	filtered := filterSuppressedVulnerabilities(
		vulns,
		map[string]*models.Suppression{
			"CVE-2026-31789": {VulnID: "CVE-2026-31789"},
		},
		map[string]*models.XraySuppression{},
	)

	status, violations := EvaluatePolicy(policy, filtered)
	if status != "pass" {
		t.Fatalf("expected pass status, got %q", status)
	}
	if len(violations) != 0 {
		t.Fatalf("expected 0 violations, got %d", len(violations))
	}
}

func TestPolicyExcludeSuppressedStillFailsWhenUnsuppressedViolationExists(t *testing.T) {
	policy := &models.OrgPolicy{
		IncludeSuppressed: false,
		Rules: models.PolicyRuleList{
			{Type: "max_cvss", Value: 8},
		},
	}
	vulns := []models.Vulnerability{
		{VulnID: "CVE-2026-31789", PkgName: "openssl", CVSSScore: 9.8},
		{VulnID: "CVE-2026-40000", PkgName: "glibc", CVSSScore: 9.1},
	}
	filtered := filterSuppressedVulnerabilities(
		vulns,
		map[string]*models.Suppression{
			"CVE-2026-31789": {VulnID: "CVE-2026-31789"},
		},
		map[string]*models.XraySuppression{},
	)

	status, violations := EvaluatePolicy(policy, filtered)
	if status != "fail" {
		t.Fatalf("expected fail status, got %q", status)
	}
	if len(violations) != 1 {
		t.Fatalf("expected 1 violation, got %d", len(violations))
	}
	if violations[0].VulnID != "CVE-2026-40000" {
		t.Fatalf("expected unsuppressed vulnerability to fail, got %q", violations[0].VulnID)
	}
}

func TestPolicyExcludeSuppressedExpiredSuppressionDoesNotExcludeWhenNotEffective(t *testing.T) {
	policy := &models.OrgPolicy{
		IncludeSuppressed: false,
		Rules: models.PolicyRuleList{
			{Type: "max_cvss", Value: 8},
		},
	}
	vulns := []models.Vulnerability{
		{VulnID: "CVE-2026-31789", PkgName: "openssl", CVSSScore: 9.8},
	}

	// Expired suppressions are expected to be dropped by effective suppression loaders.
	// Simulate that effective map behavior by passing no suppression entry.
	filtered := filterSuppressedVulnerabilities(vulns, map[string]*models.Suppression{}, map[string]*models.XraySuppression{})

	status, violations := EvaluatePolicy(policy, filtered)
	if status != "fail" {
		t.Fatalf("expected fail status, got %q", status)
	}
	if len(violations) != 1 {
		t.Fatalf("expected 1 violation, got %d", len(violations))
	}
}
