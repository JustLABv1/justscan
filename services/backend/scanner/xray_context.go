package scanner

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func GetVulnerabilityContextAnalysis(ctx context.Context, db *bun.DB, scan *models.Scan, vulnerability *models.Vulnerability) (*models.VulnerabilityContextAnalysis, error) {
	if scan == nil {
		return nil, fmt.Errorf("scan is required")
	}
	if vulnerability == nil {
		return nil, fmt.Errorf("vulnerability is required")
	}

	analysis := &models.VulnerabilityContextAnalysis{
		Provider:        scan.ScanProvider,
		Supported:       scan.ScanProvider == models.ScanProviderArtifactoryXray,
		Available:       false,
		VulnerabilityID: vulnerability.VulnID,
		ComponentID:     strings.TrimSpace(vulnerability.ExternalComponentID),
	}

	if scan.ScanProvider != models.ScanProviderArtifactoryXray {
		analysis.Message = "Contextual analysis is available only for Xray-backed scans."
		return analysis, nil
	}
	if analysis.ComponentID == "" {
		analysis.Message = "This finding does not include enough Xray component metadata yet. Re-scan the image after the Xray metadata migration if you need contextual analysis for older results."
		return analysis, nil
	}
	if scan.RegistryID == nil {
		analysis.Message = "This Xray scan is missing its registry configuration, so contextual analysis is unavailable."
		return analysis, nil
	}

	registry := &models.Registry{}
	if err := db.NewSelect().Model(registry).Where("id = ?", *scan.RegistryID).Scan(ctx); err != nil {
		return nil, fmt.Errorf("failed to load registry for contextual analysis: %w", err)
	}

	client, err := newXrayClient(registry, nil, nil)
	if err != nil {
		return nil, err
	}

	_, artifactPath, pathErr := xrayArtifactPaths(scan.ImageName, scan.ImageTag, registry, client.artifactoryID)
	if pathErr == nil {
		repoKey, artifactName, imageTag, partsErr := xrayImageParts(scan.ImageName, scan.ImageTag, registry)
		if partsErr == nil {
			manifestFilename := client.resolveManifestFilename(ctx, repoKey+"/"+artifactName, imageTag)
			if manifestFilename != "manifest.json" {
				artifactPath = client.artifactoryID + "/" + repoKey + "/" + artifactName + "/" + imageTag + "/" + manifestFilename
			}
		}
		analysis.ArtifactPath = artifactPath
	}
	analysis.SourceComponentID = analysis.ComponentID

	raw, err := client.contextualAnalysis(ctx, vulnerability.VulnID, analysis.ComponentID, analysis.SourceComponentID, analysis.ArtifactPath)
	if err != nil {
		var httpErr *xrayHTTPError
		if errors.As(err, &httpErr) {
			switch httpErr.StatusCode {
			case http.StatusBadRequest, http.StatusNotFound:
				analysis.Message = "Xray does not currently expose contextual analysis for this finding."
				return analysis, nil
			case http.StatusForbidden, http.StatusUnauthorized:
				analysis.Message = "The configured Xray credentials do not have permission to read contextual analysis for this finding."
				return analysis, nil
			}
		}
		return nil, err
	}

	analysis.Available = len(raw) > 0
	analysis.Raw = raw
	if applicable, ok := xrayContextBool(raw, map[string]bool{"applicable": true, "is_applicable": true, "not_applicable": true}); ok {
		analysis.Applicable = &applicable
	}
	analysis.Summary = xrayContextSummary(raw, analysis.Applicable)
	analysis.Evidence = xrayContextEvidence(raw)
	analysis.DependencyPaths = xrayContextDependencyPaths(raw)
	if !analysis.Available && analysis.Message == "" {
		analysis.Message = "Xray returned an empty contextual-analysis response for this finding."
	}

	return analysis, nil
}

func xrayContextSummary(raw models.JSONObject, applicable *bool) string {
	if summary := firstContextString(raw, func(key string) bool {
		return key == "summary" || key == "status" || key == "applicability" || key == "analysis" || key == "message"
	}); summary != "" {
		return summary
	}
	if applicable == nil {
		return ""
	}
	if *applicable {
		return "Xray marks this vulnerability as applicable to the selected component."
	}
	return "Xray marks this vulnerability as not applicable to the selected component."
}

func xrayContextEvidence(raw models.JSONObject) []string {
	return collectContextStrings(raw, func(key string) bool {
		return strings.Contains(key, "evidence") || strings.Contains(key, "reason") || strings.Contains(key, "detail") || strings.Contains(key, "description") || strings.Contains(key, "explanation")
	}, 8)
}

func xrayContextDependencyPaths(raw models.JSONObject) []string {
	return collectContextStrings(raw, func(key string) bool {
		return key == "path" || strings.Contains(key, "dependency_path") || strings.Contains(key, "component_path") || key == "paths" || key == "dependency_paths"
	}, 6)
}

func xrayContextBool(value any, keys map[string]bool) (bool, bool) {
	switch typed := value.(type) {
	case map[string]any:
		for key, item := range typed {
			normalizedKey := strings.ToLower(strings.TrimSpace(key))
			if keys[normalizedKey] {
				if parsed, ok := parseContextBool(item); ok {
					if normalizedKey == "not_applicable" {
						return !parsed, true
					}
					return parsed, true
				}
			}
			if parsed, ok := xrayContextBool(item, keys); ok {
				return parsed, true
			}
		}
	case []any:
		for _, item := range typed {
			if parsed, ok := xrayContextBool(item, keys); ok {
				return parsed, true
			}
		}
	}
	return false, false
}

func parseContextBool(value any) (bool, bool) {
	switch typed := value.(type) {
	case bool:
		return typed, true
	case string:
		parsed, err := strconv.ParseBool(strings.TrimSpace(typed))
		return parsed, err == nil
	default:
		return false, false
	}
}

func firstContextString(value any, match func(string) bool) string {
	results := collectContextStrings(value, match, 1)
	if len(results) == 0 {
		return ""
	}
	return results[0]
}

func collectContextStrings(value any, match func(string) bool, limit int) []string {
	if limit <= 0 {
		return nil
	}
	results := make([]string, 0, limit)
	seen := make(map[string]bool)
	var walk func(any)
	walk = func(current any) {
		if len(results) >= limit {
			return
		}
		switch typed := current.(type) {
		case map[string]any:
			for key, item := range typed {
				normalizedKey := strings.ToLower(strings.TrimSpace(key))
				if match(normalizedKey) {
					appendContextStrings(item, &results, seen, limit)
					if len(results) >= limit {
						return
					}
				}
				walk(item)
				if len(results) >= limit {
					return
				}
			}
		case []any:
			for _, item := range typed {
				walk(item)
				if len(results) >= limit {
					return
				}
			}
		}
	}

	walk(value)
	return results
}

func appendContextStrings(value any, results *[]string, seen map[string]bool, limit int) {
	if len(*results) >= limit {
		return
	}
	switch typed := value.(type) {
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" || seen[trimmed] {
			return
		}
		seen[trimmed] = true
		*results = append(*results, trimmed)
	case []any:
		for _, item := range typed {
			appendContextStrings(item, results, seen, limit)
			if len(*results) >= limit {
				return
			}
		}
	case map[string]any:
		for _, item := range typed {
			appendContextStrings(item, results, seen, limit)
			if len(*results) >= limit {
				return
			}
		}
	}
}
