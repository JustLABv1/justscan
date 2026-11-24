package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"justscan-backend/pkg/models"
)

// xrayIgnoreRuleListPageLimit bounds the single ignore-rule listing. Larger
// rule sets fall back to per-vulnerability lookups.
const xrayIgnoreRuleListPageLimit = 50

// xrayIgnoreRuleScope is the parsed ignore_filters block of an Xray ignore rule.
type xrayIgnoreRuleScope struct {
	Known            bool
	Vulnerabilities  []string
	AnyVulnerability bool
	HasLicenses      bool
	HasNonImage      bool
	Components       []string
	Artifacts        []xrayIgnoreRuleArtifact
	Watches          []string
	Policies         []string
}

type xrayIgnoreRuleArtifact struct {
	Name    string
	Version string
	Path    string
}

// xrayIgnoreRuleImage identifies the scanned image for artifact-scoped rules.
type xrayIgnoreRuleImage struct {
	Name          string
	Tag           string
	Digest        string
	ArtifactPaths []string
}

// listIgnoreRules pages through the ignore rules visible to the credential.
func (c *xrayClient) listIgnoreRules(ctx context.Context) ([]xrayIgnoreRule, error) {
	const pageSize = 100
	var results []xrayIgnoreRule
	seen := make(map[string]bool)
	for pageNumber := 1; ; pageNumber++ {
		if pageNumber > xrayIgnoreRuleListPageLimit {
			return nil, fmt.Errorf("more than %d ignore rules are visible; using per-vulnerability lookups", xrayIgnoreRuleListPageLimit*pageSize)
		}
		params := url.Values{}
		params.Set("page_num", strconv.Itoa(pageNumber))
		params.Set("num_of_rows", strconv.Itoa(pageSize))
		params.Set("order_by", "created")
		params.Set("direction", "desc")

		var raw any
		if _, err := c.doJSON(ctx, http.MethodGet, "/xray/api/v1/ignore_rules?"+params.Encode(), nil, &raw, http.StatusOK); err != nil {
			return nil, err
		}
		page := extractXrayIgnoreRules(raw)
		before := len(results)
		for _, rule := range page {
			encoded, _ := json.Marshal(rule.Raw)
			key := firstNonEmpty(rule.RuleID, string(encoded))
			if key == "" || seen[key] {
				continue
			}
			seen[key] = true
			results = append(results, rule)
		}
		if len(page) < pageSize || len(results) == before {
			return results, nil
		}
	}
}

// matchXrayIgnoreRules returns the rules that apply to this image, keyed by
// the scan's vulnerability IDs (vulnIDs maps each ID to its Xray issue IDs).
// It returns false when a rule has no recognizable ignore_filters, because
// its scope cannot be evaluated locally.
func matchXrayIgnoreRules(rules []xrayIgnoreRule, vulnIDs map[string][]string, image xrayIgnoreRuleImage, now time.Time) (map[string][]xrayIgnoreRule, bool) {
	results := make(map[string][]xrayIgnoreRule)
	for _, rule := range rules {
		scope := parseXrayIgnoreRuleScope(rule.Raw)
		if !scope.Known {
			return nil, false
		}
		if expired, ok := findBoolValue(rule.Raw, "is_expired"); ok && expired {
			continue
		}
		if rule.ExpiresAt != nil && !rule.ExpiresAt.After(now) {
			continue
		}
		if !scope.appliesToImage(image) {
			continue
		}
		rule.Components = scope.Components
		rule.WatchNames = scope.Watches
		for vulnID, issueIDs := range vulnIDs {
			if scope.matchesVulnerability(vulnID, issueIDs) {
				results[vulnID] = append(results[vulnID], rule)
			}
		}
	}
	return results, true
}

func parseXrayIgnoreRuleScope(raw models.JSONObject) xrayIgnoreRuleScope {
	filters, ok := raw["ignore_filters"].(map[string]any)
	if !ok {
		if typed, typedOK := raw["ignore_filters"].(models.JSONObject); typedOK {
			filters, ok = typed, true
		}
	}
	if !ok {
		return xrayIgnoreRuleScope{}
	}

	scope := xrayIgnoreRuleScope{Known: true}
	for _, value := range append(xrayIgnoreFilterStrings(filters["vulnerabilities"]), xrayIgnoreFilterStrings(filters["cves"])...) {
		if strings.EqualFold(value, "any") {
			scope.AnyVulnerability = true
			continue
		}
		scope.Vulnerabilities = append(scope.Vulnerabilities, value)
	}
	scope.HasLicenses = len(xrayIgnoreFilterStrings(filters["licenses"])) > 0
	scope.Components = xrayIgnoreComponentRefs(filters["components"])
	scope.Watches = xrayIgnoreFilterStrings(filters["watches"])
	scope.Policies = xrayIgnoreFilterStrings(filters["policies"])
	for _, key := range []string{"builds", "release-bundles", "release_bundles", "release_bundles_v2"} {
		if entries, ok := filters[key].([]any); ok && len(entries) > 0 {
			scope.HasNonImage = true
		}
	}
	if entries, ok := filters["artifacts"].([]any); ok {
		for _, entry := range entries {
			object, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			scope.Artifacts = append(scope.Artifacts, xrayIgnoreRuleArtifact{
				Name:    stringFromIgnoreFilter(object["name"]),
				Version: stringFromIgnoreFilter(object["version"]),
				Path:    stringFromIgnoreFilter(object["path"]),
			})
		}
	}
	return scope
}

func (scope xrayIgnoreRuleScope) matchesVulnerability(vulnID string, issueIDs []string) bool {
	if len(scope.Vulnerabilities) == 0 {
		// License-only rules never cover vulnerabilities; rules without any
		// vulnerability filter cover every vulnerability in their scope.
		return scope.AnyVulnerability || !scope.HasLicenses
	}
	for _, candidate := range append([]string{vulnID}, issueIDs...) {
		for _, value := range scope.Vulnerabilities {
			if strings.EqualFold(strings.TrimSpace(candidate), value) {
				return true
			}
		}
	}
	return scope.AnyVulnerability
}

func (scope xrayIgnoreRuleScope) appliesToImage(image xrayIgnoreRuleImage) bool {
	if len(scope.Artifacts) == 0 {
		// Build or release-bundle rules do not apply to a standalone image.
		return !scope.HasNonImage
	}
	for _, artifact := range scope.Artifacts {
		if artifact.matches(image) {
			return true
		}
	}
	return false
}

func (artifact xrayIgnoreRuleArtifact) matches(image xrayIgnoreRuleImage) bool {
	name := strings.Trim(strings.ToLower(artifact.Name), "/")
	path := strings.Trim(strings.ToLower(artifact.Path), "/")
	path = strings.TrimSuffix(strings.TrimSuffix(path, "/manifest.json"), "/list.manifest.json")
	if name == "" && path == "" {
		// Unrecognized artifact entry: keep the rule rather than silently
		// dropping a suppression.
		return true
	}
	if path != "" {
		for _, artifactPath := range image.ArtifactPaths {
			candidate := strings.Trim(strings.ToLower(artifactPath), "/")
			if candidate == path || strings.HasPrefix(candidate, path+"/") || strings.Contains(candidate, "/"+path+"/") {
				return true
			}
		}
	}
	if name == "" {
		return false
	}
	imageName := strings.Trim(strings.ToLower(image.Name), "/")
	lastSegment := strings.ToLower(lastPathSegment(image.Name))
	nameMatches := name == imageName || name == lastSegment || strings.HasSuffix(imageName, "/"+name) || strings.HasSuffix(name, "/"+lastSegment)
	if !nameMatches {
		return false
	}
	version := strings.TrimSpace(strings.ToLower(artifact.Version))
	if version == "" || version == "*" || version == "any" {
		return true
	}
	digest := strings.ToLower(strings.TrimSpace(image.Digest))
	return version == strings.ToLower(strings.TrimSpace(image.Tag)) || (digest != "" && (version == digest || version == xrayDigestArtifactReference(digest)))
}

// xrayIgnoreComponentRefs reads component references from ignore filters or
// ignored violation rows: plain strings, {component_id}, or {name, version}.
func xrayIgnoreComponentRefs(value any) []string {
	refs := make([]string, 0, 2)
	var add func(any)
	add = func(value any) {
		switch typed := value.(type) {
		case string:
			if trimmed := strings.TrimSpace(typed); trimmed != "" {
				refs = append(refs, trimmed)
			}
		case []any:
			for _, entry := range typed {
				add(entry)
			}
		case []string:
			for _, entry := range typed {
				add(entry)
			}
		case models.JSONObject:
			add(map[string]any(typed))
		case map[string]any:
			if id := firstNonEmpty(stringFromIgnoreFilter(typed["component_id"]), stringFromIgnoreFilter(typed["id"])); id != "" {
				add(id)
				return
			}
			name := stringFromIgnoreFilter(typed["name"])
			if version := stringFromIgnoreFilter(typed["version"]); name != "" && version != "" {
				add(name + ":" + version)
			} else {
				add(name)
			}
		}
	}
	add(value)
	return dedupeStrings(refs)
}

func xrayIgnoreFilterStrings(value any) []string {
	values := make([]string, 0)
	entries, ok := value.([]any)
	if !ok {
		if text := stringFromIgnoreFilter(value); text != "" {
			return []string{text}
		}
		return values
	}
	for _, entry := range entries {
		switch typed := entry.(type) {
		case string:
			if trimmed := strings.TrimSpace(typed); trimmed != "" {
				values = append(values, trimmed)
			}
		case map[string]any:
			if name := firstNonEmpty(stringFromIgnoreFilter(typed["name"]), stringFromIgnoreFilter(typed["id"])); name != "" {
				values = append(values, name)
			}
		}
	}
	return dedupeStrings(values)
}

func stringFromIgnoreFilter(value any) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}
