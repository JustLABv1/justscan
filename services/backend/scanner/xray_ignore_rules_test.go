package scanner

import (
	"context"
	"net/http"
	"testing"
	"time"

	"justscan-backend/pkg/models"
)

func xrayTestIgnoreRule(id string, filters map[string]any) xrayIgnoreRule {
	return xrayIgnoreRule{RuleID: id, Raw: models.JSONObject{"id": id, "ignore_filters": filters}}
}

func TestMatchXrayIgnoreRulesEvaluatesScopeLocally(t *testing.T) {
	now := time.Date(2026, 11, 24, 0, 0, 0, 0, time.UTC)
	past := now.Add(-time.Hour)
	image := xrayIgnoreRuleImage{Name: "docker-virtual/library/nginx", Tag: "1.27", Digest: "sha256:abc", ArtifactPaths: []string{"default/docker-remote-cache/library/nginx/sha256__abc/manifest.json"}}
	rules := []xrayIgnoreRule{
		xrayTestIgnoreRule("global", map[string]any{"cves": []any{"CVE-1"}}),
		xrayTestIgnoreRule("component", map[string]any{"cves": []any{"CVE-2"}, "components": []any{map[string]any{"name": "deb://debian:bookworm:openssl", "version": "3.0.11"}}, "watches": []any{"prod", "dev"}}),
		xrayTestIgnoreRule("same-image", map[string]any{"vulnerabilities": []any{"XRAY-3"}, "artifacts": []any{map[string]any{"name": "library/nginx", "version": "1.27"}}}),
		xrayTestIgnoreRule("other-tag", map[string]any{"cves": []any{"CVE-1"}, "artifacts": []any{map[string]any{"name": "library/nginx", "version": "1.26"}}}),
		xrayTestIgnoreRule("other-image", map[string]any{"cves": []any{"CVE-1"}, "artifacts": []any{map[string]any{"name": "library/redis"}}}),
		xrayTestIgnoreRule("license-only", map[string]any{"licenses": []any{"GPL-3.0"}}),
		xrayTestIgnoreRule("build-only", map[string]any{"cves": []any{"CVE-1"}, "builds": []any{map[string]any{"name": "ci"}}}),
		{RuleID: "expired", ExpiresAt: &past, Raw: models.JSONObject{"ignore_filters": map[string]any{"cves": []any{"CVE-1"}}}},
	}
	vulnIDs := map[string][]string{"CVE-1": nil, "CVE-2": nil, "CVE-3": {"XRAY-3"}}

	matched, ok := matchXrayIgnoreRules(rules, vulnIDs, image, now)
	if !ok {
		t.Fatal("known rule formats were rejected")
	}
	ruleIDs := func(vulnID string) []string {
		ids := []string{}
		for _, rule := range matched[vulnID] {
			ids = append(ids, rule.RuleID)
		}
		return ids
	}
	if got := ruleIDs("CVE-1"); len(got) != 1 || got[0] != "global" {
		t.Fatalf("CVE-1 rules: %v", got)
	}
	if got := matched["CVE-2"]; len(got) != 1 || len(got[0].Components) != 1 || got[0].Components[0] != "deb://debian:bookworm:openssl:3.0.11" || len(got[0].WatchNames) != 2 {
		t.Fatalf("CVE-2 component rule: %#v", got)
	}
	if got := ruleIDs("CVE-3"); len(got) != 1 || got[0] != "same-image" {
		t.Fatalf("CVE-3 should match by Xray issue ID and artifact: %v", got)
	}
}

func TestMatchXrayIgnoreRulesRejectsUnknownFormat(t *testing.T) {
	_, ok := matchXrayIgnoreRules([]xrayIgnoreRule{{RuleID: "legacy", Raw: models.JSONObject{"id": "legacy"}}}, map[string][]string{"CVE-1": nil}, xrayIgnoreRuleImage{Name: "repo/image"}, time.Now())
	if ok {
		t.Fatal("rules without ignore_filters must fall back to per-vulnerability lookups")
	}
}

func TestListIgnoreRulesPaginatesOnce(t *testing.T) {
	requests := 0
	client := &xrayClient{baseURL: "http://xray.test", httpClient: newTestHTTPClient(func(req *http.Request) (*http.Response, error) {
		requests++
		if req.URL.Query().Get("cve") != "" || req.URL.Query().Get("vulnerability") != "" {
			t.Fatal("listing must not filter by vulnerability")
		}
		if req.URL.Query().Get("page_num") == "1" {
			items := make([]map[string]any, 100)
			for i := range items {
				items[i] = map[string]any{"id": "rule-" + string(rune('a'+i%26)) + string(rune('a'+i/26)), "ignore_filters": map[string]any{}}
			}
			return jsonResponse(200, map[string]any{"data": items}), nil
		}
		return jsonResponse(200, map[string]any{"data": []map[string]any{{"id": "last", "ignore_filters": map[string]any{}}}}), nil
	})}
	rules, err := client.listIgnoreRules(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if requests != 2 || len(rules) != 101 {
		t.Fatalf("expected 2 requests and 101 rules, got %d and %d", requests, len(rules))
	}
}

func TestExportViolationDetailsIsSharedPerScan(t *testing.T) {
	requests := 0
	client := &xrayClient{baseURL: "http://xray.test", httpClient: newTestHTTPClient(func(*http.Request) (*http.Response, error) {
		requests++
		return jsonResponse(200, map[string]any{"violations": []any{map[string]any{"issue_id": "CVE-1", "watch_name": "prod", "is_ignored": true, "ignore_rule_id": "r1", "infected_components": []any{"npm://lodash:4.17.20"}}}}), nil
	})}
	if _, err := client.exportViolations(context.Background(), "repo/image:tag", "default/repo/image/tag/manifest.json"); err != nil {
		t.Fatal(err)
	}
	rules, err := client.exportIgnoredViolationRules(context.Background(), "repo/image:tag", "default/repo/image/tag/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	if requests != 1 {
		t.Fatalf("exportDetails should be requested once per component path, got %d", requests)
	}
	if len(rules) != 1 || len(rules[0].Rule.Components) != 1 || rules[0].Rule.Components[0] != "npm://lodash:4.17.20" {
		t.Fatalf("ignored export row lost its component scope: %#v", rules)
	}
}
