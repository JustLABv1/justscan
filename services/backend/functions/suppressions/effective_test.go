package suppressions

import (
	"testing"
	"time"

	"justscan-backend/pkg/models"
)

func TestMergeEffectiveSuppressionPrefersLocalForMixedSource(t *testing.T) {
	localExpiry := time.Now().Add(24 * time.Hour)
	xrayExpiry := time.Now().Add(48 * time.Hour)

	local := &models.Suppression{
		VulnID:        "CVE-2026-1000",
		ImageDigest:   "sha256:local",
		Status:        models.SuppressionWontFix,
		Justification: "Accepted internally",
		ExpiresAt:     &localExpiry,
	}
	xray := &models.XraySuppression{
		VulnID:        "CVE-2026-1000",
		ImageDigest:   "sha256:local",
		RuleID:        "rule-1",
		PolicyName:    "Policy Alpha",
		WatchName:     "Watch Beta",
		Justification: "Ignored by Xray",
		ExpiresAt:     &xrayExpiry,
	}

	merged := MergeEffectiveSuppression(local, xray)
	if merged == nil {
		t.Fatal("expected merged suppression")
	}
	if merged.Source != "mixed" {
		t.Fatalf("expected source mixed, got %q", merged.Source)
	}
	if merged.Status != models.SuppressionWontFix {
		t.Fatalf("expected local status to win, got %q", merged.Status)
	}
	if merged.Justification != "Accepted internally" {
		t.Fatalf("expected local justification to win, got %q", merged.Justification)
	}
	if merged.XrayPolicyName != "Policy Alpha" {
		t.Fatalf("expected xray policy name to be preserved, got %q", merged.XrayPolicyName)
	}
	if merged.ReadOnly {
		t.Fatal("expected mixed suppression to remain editable")
	}
}

func TestMergeEffectiveSuppressionBuildsReadOnlyXraySuppression(t *testing.T) {
	xray := &models.XraySuppression{
		VulnID:        "CVE-2026-2000",
		ImageDigest:   "sha256:xray",
		RuleID:        "rule-x",
		PolicyName:    "Policy Gamma",
		WatchName:     "Watch Delta",
		Justification: "Provider-managed ignore rule",
	}

	merged := MergeEffectiveSuppression(nil, xray)
	if merged == nil {
		t.Fatal("expected xray-only suppression")
	}
	if merged.Status != models.SuppressionXrayIgnore {
		t.Fatalf("expected xray_ignore status, got %q", merged.Status)
	}
	if merged.Source != "xray" {
		t.Fatalf("expected xray source, got %q", merged.Source)
	}
	if !merged.ReadOnly {
		t.Fatal("expected xray-only suppression to be read-only")
	}
	if merged.XrayRuleID != "rule-x" {
		t.Fatalf("expected xray rule id, got %q", merged.XrayRuleID)
	}
}
