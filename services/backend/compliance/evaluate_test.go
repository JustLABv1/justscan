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
