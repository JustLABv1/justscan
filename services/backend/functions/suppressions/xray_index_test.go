package suppressions

import (
	"testing"

	"justscan-backend/pkg/models"
)

func TestXraySuppressionIndexMatchesComponentScope(t *testing.T) {
	scoped := &models.XraySuppression{VulnID: "CVE-1", RuleID: "scoped", Components: []string{"deb://debian:bookworm:openssl:3.0.11"}}
	index := XraySuppressionIndex{"CVE-1": {scoped}}

	openssl := &models.Vulnerability{VulnID: "CVE-1", PkgName: "openssl", InstalledVersion: "3.0.11"}
	libssl := &models.Vulnerability{VulnID: "CVE-1", PkgName: "libssl3", InstalledVersion: "3.0.11"}
	if index.Match(openssl) != scoped {
		t.Fatal("component-scoped rule did not suppress its component")
	}
	if index.Match(libssl) != nil {
		t.Fatal("component-scoped rule suppressed another package")
	}

	global := &models.XraySuppression{VulnID: "CVE-1", RuleID: "global"}
	index["CVE-1"] = append(index["CVE-1"], global)
	if index.Match(libssl) != global {
		t.Fatal("unscoped rule should suppress every component")
	}
}
