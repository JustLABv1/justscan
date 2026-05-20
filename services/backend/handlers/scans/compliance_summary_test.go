package scans

import (
	"testing"
	"time"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
)

func TestScopedOrgIDFromScopeValue(t *testing.T) {
	validOrgID := "11111111-1111-1111-1111-111111111111"

	tests := []struct {
		name    string
		scope   string
		wantOK  bool
		wantOrg string
	}{
		{name: "empty scope", scope: "", wantOK: false},
		{name: "personal scope", scope: "personal", wantOK: false},
		{name: "personal scope mixed case", scope: "Personal", wantOK: false},
		{name: "invalid uuid scope", scope: "not-a-uuid", wantOK: false},
		{name: "org scope", scope: validOrgID, wantOK: true, wantOrg: validOrgID},
		{name: "org scope with spaces", scope: " " + validOrgID + " ", wantOK: true, wantOrg: validOrgID},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			gotOrgID, gotOK := scopedOrgIDFromScopeValue(test.scope)
			if gotOK != test.wantOK {
				t.Fatalf("expected ok=%v, got %v", test.wantOK, gotOK)
			}
			if !test.wantOK {
				return
			}
			if gotOrgID.String() != test.wantOrg {
				t.Fatalf("expected org id %s, got %s", test.wantOrg, gotOrgID.String())
			}
		})
	}
}

func TestSummarizeScanComplianceRows(t *testing.T) {
	scanA := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	scanB := uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	policyA := uuid.MustParse("10000000-0000-0000-0000-000000000001")
	policyB := uuid.MustParse("10000000-0000-0000-0000-000000000002")
	policyC := uuid.MustParse("10000000-0000-0000-0000-000000000003")

	now := time.Now().UTC()
	older := now.Add(-10 * time.Minute)
	newer := now.Add(10 * time.Minute)

	rows := []models.ComplianceResult{
		{ScanID: scanA, PolicyID: policyB, Status: "pass", EvaluatedAt: older},
		{ScanID: scanA, PolicyID: policyA, Status: "fail", EvaluatedAt: now},
		{ScanID: scanA, PolicyID: policyA, Status: "fail", EvaluatedAt: newer},
		{ScanID: scanB, PolicyID: policyC, Status: "pass", EvaluatedAt: now},
	}
	policyNames := map[uuid.UUID]string{
		policyA: "CVSS < 8",
		policyB: "No criticals",
		policyC: "",
	}
	policyDetails := map[uuid.UUID]models.ScanCompliancePolicy{
		policyA: {Name: "CVSS < 8", RuleSummaries: []string{"Max CVSS < 8.0"}},
		policyB: {Name: "No criticals", RuleSummaries: []string{"Max CRITICAL vulnerabilities: 0"}},
	}

	summaries := summarizeScanComplianceRows(rows, policyNames, policyDetails)

	if len(summaries) != 2 {
		t.Fatalf("expected 2 scan summaries, got %d", len(summaries))
	}

	scanASummary := summaries[scanA]
	if scanASummary == nil {
		t.Fatal("expected scan A summary")
	}
	if scanASummary.Status != "fail" {
		t.Fatalf("expected scan A status fail, got %s", scanASummary.Status)
	}
	if scanASummary.PassCount != 1 {
		t.Fatalf("expected scan A pass count 1, got %d", scanASummary.PassCount)
	}
	if scanASummary.FailCount != 2 {
		t.Fatalf("expected scan A fail count 2, got %d", scanASummary.FailCount)
	}
	if scanASummary.EvaluatedAt == nil || !scanASummary.EvaluatedAt.Equal(newer) {
		t.Fatalf("expected scan A evaluated_at %s, got %#v", newer, scanASummary.EvaluatedAt)
	}

	wantPolicyNames := []string{"CVSS < 8", "No criticals"}
	if len(scanASummary.PolicyNames) != len(wantPolicyNames) {
		t.Fatalf("expected %d scan A policy names, got %d", len(wantPolicyNames), len(scanASummary.PolicyNames))
	}
	for index, want := range wantPolicyNames {
		if scanASummary.PolicyNames[index] != want {
			t.Fatalf("expected scan A policy_names[%d]=%q, got %q", index, want, scanASummary.PolicyNames[index])
		}
	}

	if len(scanASummary.FailedPolicyNames) != 1 || scanASummary.FailedPolicyNames[0] != "CVSS < 8" {
		t.Fatalf("unexpected scan A failed policy names: %#v", scanASummary.FailedPolicyNames)
	}
	if len(scanASummary.FailedPolicies) != 1 {
		t.Fatalf("expected one failed policy detail, got %#v", scanASummary.FailedPolicies)
	}
	if scanASummary.FailedPolicies[0].Name != "CVSS < 8" {
		t.Fatalf("unexpected failed policy name %q", scanASummary.FailedPolicies[0].Name)
	}
	if len(scanASummary.FailedPolicies[0].RuleSummaries) != 1 ||
		scanASummary.FailedPolicies[0].RuleSummaries[0] != "Max CVSS < 8.0" {
		t.Fatalf("unexpected failed policy rules: %#v", scanASummary.FailedPolicies[0].RuleSummaries)
	}

	scanBSummary := summaries[scanB]
	if scanBSummary == nil {
		t.Fatal("expected scan B summary")
	}
	if scanBSummary.Status != "pass" {
		t.Fatalf("expected scan B status pass, got %s", scanBSummary.Status)
	}
	if scanBSummary.PassCount != 1 || scanBSummary.FailCount != 0 {
		t.Fatalf(
			"expected scan B pass/fail counts 1/0, got %d/%d",
			scanBSummary.PassCount,
			scanBSummary.FailCount,
		)
	}
	if len(scanBSummary.PolicyNames) != 0 {
		t.Fatalf("expected scan B to skip unnamed policies, got %#v", scanBSummary.PolicyNames)
	}
	if len(scanBSummary.FailedPolicyNames) != 0 {
		t.Fatalf("expected scan B failed policy names to be empty, got %#v", scanBSummary.FailedPolicyNames)
	}
	if len(scanBSummary.FailedPolicies) != 0 {
		t.Fatalf("expected scan B failed policy details to be empty, got %#v", scanBSummary.FailedPolicies)
	}
}
