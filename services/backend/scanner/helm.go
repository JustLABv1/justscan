package scanner

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/engine"
	helmregistry "helm.sh/helm/v3/pkg/registry"

	log "github.com/sirupsen/logrus"
	"sigs.k8s.io/yaml"
)

var digestSuffixPattern = regexp.MustCompile(`:([A-Za-z][A-Za-z0-9+._-]*:[0-9a-fA-F]{32,})$`)

// HelmImage represents a container image found in a Helm chart template.
type HelmImage struct {
	FullRef    string `json:"full_ref"`    // e.g. "nginx:1.25.0"
	Name       string `json:"name"`        // e.g. "nginx"
	Tag        string `json:"tag"`         // e.g. "1.25.0"
	SourceFile string `json:"source_file"` // e.g. "templates/deployment.yaml"
	SourcePath string `json:"source_path"` // e.g. "spec.template.spec.containers[0].image"
}

// ResolveHelmChartInput normalizes chart inputs into a canonical Helm pull target.
// Known OCI registry hosts are accepted without an explicit oci:// prefix so
// persisted reruns can recover from older non-canonical chart URLs.
func ResolveHelmChartInput(chartURL, chartName string) (resolvedChartURL, resolvedChartName string, isOCI bool) {
	resolvedChartURL = strings.TrimSpace(chartURL)
	resolvedChartName = strings.TrimSpace(chartName)

	if resolvedChartURL == "" {
		return "", resolvedChartName, false
	}

	if strings.HasPrefix(resolvedChartURL, "oci://") {
		return joinOCIChartURL(resolvedChartURL, resolvedChartName), "", true
	}

	if hasHTTPScheme(resolvedChartURL) {
		return strings.TrimRight(resolvedChartURL, "/"), resolvedChartName, false
	}

	if looksLikeOCIChartURL(resolvedChartURL) {
		return joinOCIChartURL("oci://"+strings.TrimLeft(resolvedChartURL, "/"), resolvedChartName), "", true
	}

	return resolvedChartURL, resolvedChartName, false
}

// ExtractHelmImages pulls a Helm chart (OCI or HTTP repo), renders all templates
// including subcharts, and returns all unique container images found.
// registryEnvVars are Trivy-style env vars (TRIVY_USERNAME, etc.) — we map them to
// Helm registry credentials when the chart URL is an OCI chart.
func ExtractHelmImages(_ context.Context, chartURL, chartName, chartVersion string, registryEnvVars []string) ([]HelmImage, string, string, error) {
	chartURL, chartName, isOCI := ResolveHelmChartInput(chartURL, chartName)

	tmpDir, err := os.MkdirTemp("", "justscan-helm-*")
	if err != nil {
		return nil, "", "", fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// Build OCI registry client (with optional credentials)
	var registryOpts []helmregistry.ClientOption
	username, password := extractRegistryCreds(registryEnvVars)
	if username != "" || password != "" {
		registryOpts = append(registryOpts, helmregistry.ClientOptBasicAuth(username, password))
	}
	registryClient, err := helmregistry.NewClient(registryOpts...)
	if err != nil {
		return nil, "", "", fmt.Errorf("create helm registry client: %w", err)
	}

	cfg := &action.Configuration{
		RegistryClient: registryClient,
	}

	// Use consistent temp-based Helm settings so we don't touch the user's ~/.helm
	settings := cli.New()
	settings.RepositoryCache = filepath.Join(tmpDir, "cache")
	settings.RepositoryConfig = filepath.Join(tmpDir, "repositories.yaml")

	pull := action.NewPullWithOpts(action.WithConfig(cfg))
	pull.Settings = settings
	pull.Untar = true
	pull.DestDir = tmpDir

	var chartRef string
	if isOCI {
		chartRef = chartURL
		if chartVersion != "" {
			pull.Version = chartVersion
		}
	} else {
		// HTTP repo: chart_url is the repo URL, chart_name is the chart
		pull.RepoURL = chartURL
		chartRef = chartName
		if chartVersion != "" {
			pull.Version = chartVersion
		}
	}

	if _, err := pull.Run(chartRef); err != nil {
		return nil, "", "", fmt.Errorf("helm pull %s: %w", chartRef, err)
	}

	// Find the extracted chart directory (first sub-directory in DestDir)
	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		return nil, "", "", fmt.Errorf("read temp dir: %w", err)
	}

	var chartDir string
	for _, e := range entries {
		if e.IsDir() && e.Name() != "cache" {
			chartDir = filepath.Join(tmpDir, e.Name())
			break
		}
	}
	if chartDir == "" {
		return nil, "", "", fmt.Errorf("helm pull produced no chart directory in %s", tmpDir)
	}

	chrt, err := loader.LoadDir(chartDir)
	if err != nil {
		return nil, "", "", fmt.Errorf("load chart dir %s: %w", chartDir, err)
	}

	resolvedName := chrt.Metadata.Name
	resolvedVersion := chrt.Metadata.Version

	rendered, err := renderChart(chrt)
	if err != nil {
		// Non-fatal — render errors are common for charts that need cluster values.
		// We still attempt to extract from what was successfully rendered.
		log.Warnf("helm render partial error for %s: %v", resolvedName, err)
	}

	images := extractImagesFromRendered(rendered)
	if len(images) == 0 {
		images = fallbackHelmImages(chrt)
	}
	if images == nil {
		images = make([]HelmImage, 0)
	}
	return images, resolvedName, resolvedVersion, nil
}

func fallbackHelmImages(chrt *chart.Chart) []HelmImage {
	images := extractImagesFromChartAnnotations(chrt)
	if len(images) > 0 {
		return images
	}

	image, ok := extractImageFromValues(chrt)
	if !ok {
		return nil
	}

	return []HelmImage{image}
}

func extractImagesFromChartAnnotations(chrt *chart.Chart) []HelmImage {
	if chrt == nil || chrt.Metadata == nil || chrt.Metadata.Annotations == nil {
		return nil
	}

	raw := strings.TrimSpace(chrt.Metadata.Annotations["artifacthub.io/images"])
	if raw == "" {
		return nil
	}

	var entries []struct {
		Image string `yaml:"image"`
	}
	if err := yaml.Unmarshal([]byte(raw), &entries); err != nil {
		return nil
	}

	images := make([]HelmImage, 0, len(entries))
	for index, entry := range entries {
		normalizedRef, name, tag := NormalizeHelmImageRef(entry.Image)
		if normalizedRef == "" || name == "" {
			continue
		}
		images = append(images, HelmImage{
			FullRef:    normalizedRef,
			Name:       name,
			Tag:        tag,
			SourceFile: "Chart.yaml",
			SourcePath: fmt.Sprintf("annotations.artifacthub.io/images[%d].image", index),
		})
	}

	return images
}

func extractImageFromValues(chrt *chart.Chart) (HelmImage, bool) {
	if chrt == nil || chrt.Values == nil {
		return HelmImage{}, false
	}

	imageValues, ok := chrt.Values["image"].(map[string]interface{})
	if !ok {
		return HelmImage{}, false
	}

	repository := strings.TrimSpace(stringValue(imageValues["repository"]))
	if repository == "" {
		return HelmImage{}, false
	}

	registry := strings.TrimSpace(stringValue(imageValues["registry"]))
	tag := strings.TrimSpace(stringValue(imageValues["tag"]))
	if tag == "" && chrt.Metadata != nil {
		tag = strings.TrimSpace(chrt.Metadata.AppVersion)
	}

	fullRef := repository
	if registry != "" {
		fullRef = strings.TrimSuffix(registry, "/") + "/" + strings.TrimPrefix(repository, "/")
	}
	if tag != "" && !strings.Contains(fullRef, "@") && !strings.Contains(filepath.Base(fullRef), ":") {
		fullRef += ":" + tag
	}

	normalizedRef, name, resolvedTag := NormalizeHelmImageRef(fullRef)
	if normalizedRef == "" || name == "" {
		return HelmImage{}, false
	}

	return HelmImage{
		FullRef:    normalizedRef,
		Name:       name,
		Tag:        resolvedTag,
		SourceFile: "values.yaml",
		SourcePath: "image.registry,image.repository,image.tag",
	}, true
}

func stringValue(value interface{}) string {
	text, _ := value.(string)
	return text
}

// renderChart renders all templates including subcharts with dummy values.
// LintMode suppresses errors from `required` and `fail` template functions
// which are common in charts that validate specific value configurations.
func renderChart(chrt *chart.Chart) (map[string]string, error) {
	// Build capability/values context that satisfies most charts
	vals, err := chartutil.ToRenderValues(chrt, chrt.Values, chartutil.ReleaseOptions{
		Name:      "release",
		Namespace: "default",
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("build render values: %w", err)
	}

	e := engine.Engine{Strict: false, LintMode: true}
	rendered, err := e.Render(chrt, vals)
	return rendered, err
}

// extractImagesFromRendered walks all rendered YAML documents and collects images.
func extractImagesFromRendered(rendered map[string]string) []HelmImage {
	seen := make(map[string]bool)
	images := make([]HelmImage, 0)

	for templatePath, content := range rendered {
		if !strings.HasSuffix(templatePath, ".yaml") && !strings.HasSuffix(templatePath, ".yml") {
			continue
		}
		// A single template file may contain multiple YAML documents separated by ---
		for _, doc := range strings.Split(content, "\n---") {
			doc = strings.TrimSpace(doc)
			if doc == "" {
				continue
			}
			found := extractImagesFromYAMLDoc(doc, templatePath)
			for _, img := range found {
				if !seen[img.FullRef] {
					seen[img.FullRef] = true
					images = append(images, img)
				}
			}
		}
	}
	return images
}

// extractImagesFromYAMLDoc extracts container images from a single Kubernetes YAML document.
func extractImagesFromYAMLDoc(docYAML, templatePath string) []HelmImage {
	// Strip the "chart-name/templates/" prefix from the path for a cleaner display
	sourceName := cleanTemplatePath(templatePath)

	var obj map[string]interface{}
	if err := yaml.Unmarshal([]byte(docYAML), &obj); err != nil || obj == nil {
		return nil
	}

	var images []HelmImage

	// Helper to add an image found at a specific jsonPath description
	add := func(rawImage, sourcePath string) {
		rawImage = strings.TrimSpace(rawImage)
		if rawImage == "" || strings.Contains(rawImage, "{{") {
			return // skip empty or un-rendered template expressions
		}
		normalizedRef, name, tag := NormalizeHelmImageRef(rawImage)
		if normalizedRef == "" || name == "" {
			return
		}
		images = append(images, HelmImage{
			FullRef:    normalizedRef,
			Name:       name,
			Tag:        tag,
			SourceFile: sourceName,
			SourcePath: sourcePath,
		})
	}

	kind, _ := obj["kind"].(string)

	switch kind {
	case "Pod":
		spec := getMap(obj, "spec")
		extractContainers(spec, "spec", add)

	case "Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job":
		spec := getMap(getMap(getMap(obj, "spec"), "template"), "spec")
		extractContainers(spec, "spec.template.spec", add)

	case "CronJob":
		spec := getMap(getMap(getMap(getMap(getMap(obj, "spec"), "jobTemplate"), "spec"), "template"), "spec")
		extractContainers(spec, "spec.jobTemplate.spec.template.spec", add)

	default:
		// Generic fallback: walk and look for any "image" string fields
		walkForImages(obj, "", add)
	}

	return images
}

// extractContainers pulls images from containers and initContainers in a pod spec.
func extractContainers(spec map[string]interface{}, prefix string, add func(string, string)) {
	for _, field := range []string{"containers", "initContainers", "ephemeralContainers"} {
		containers, ok := spec[field].([]interface{})
		if !ok {
			continue
		}
		for i, c := range containers {
			container, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			if img, ok := container["image"].(string); ok {
				add(img, fmt.Sprintf("%s.%s[%d].image", prefix, field, i))
			}
		}
	}
}

// walkForImages is a generic recursive walker for unknown resource types.
func walkForImages(obj interface{}, path string, add func(string, string)) {
	switch v := obj.(type) {
	case map[string]interface{}:
		for k, val := range v {
			childPath := k
			if path != "" {
				childPath = path + "." + k
			}
			if k == "image" {
				if s, ok := val.(string); ok {
					add(s, childPath)
					continue
				}
			}
			walkForImages(val, childPath, add)
		}
	case []interface{}:
		for i, item := range v {
			walkForImages(item, fmt.Sprintf("%s[%d]", path, i), add)
		}
	}
}

// NormalizeHelmImageRef normalizes raw image references so digest-based images
// use the canonical name@sha256:digest format while still exposing name/tag parts.
func NormalizeHelmImageRef(ref string) (normalized, name, tag string) {
	trimmed := strings.TrimSpace(ref)
	if trimmed == "" {
		return "", "", ""
	}

	if idx := strings.LastIndex(trimmed, "@"); idx != -1 {
		base, digest := trimmed[:idx], strings.TrimSpace(trimmed[idx+1:])
		namePart, _, _ := splitTagFromName(base)
		if namePart == "" || digest == "" {
			return "", "", ""
		}
		return namePart + "@" + digest, namePart, digest
	}

	if match := digestSuffixPattern.FindStringSubmatch(trimmed); len(match) == 2 {
		digest := match[1]
		base := strings.TrimSuffix(trimmed, ":"+digest)
		namePart, _, _ := splitTagFromName(base)
		if namePart == "" {
			return "", "", ""
		}
		return namePart + "@" + digest, namePart, digest
	}

	namePart, resolvedTag, explicitTag := splitTagFromName(trimmed)
	if namePart == "" {
		return "", "", ""
	}
	if explicitTag {
		return namePart + ":" + resolvedTag, namePart, resolvedTag
	}
	return namePart, namePart, resolvedTag
}

// splitImageRef splits "nginx:1.25.0" into ("nginx", "1.25.0").
// Handles digests like "nginx@sha256:abc" → ("nginx", "sha256:abc").
// Returns ("", "") for empty input.
func splitImageRef(ref string) (name, tag string) {
	_, name, tag = NormalizeHelmImageRef(ref)
	return name, tag
}

func splitTagFromName(ref string) (name, tag string, explicitTag bool) {
	if ref == "" {
		return "", "", false
	}
	lastSlash := strings.LastIndex(ref, "/")
	lastColon := strings.LastIndex(ref, ":")
	if lastColon > lastSlash {
		return ref[:lastColon], ref[lastColon+1:], true
	}
	return ref, "latest", false
}

// getMap safely navigates a map[string]interface{} chain.
func getMap(m map[string]interface{}, key string) map[string]interface{} {
	v, _ := m[key].(map[string]interface{})
	return v
}

// cleanTemplatePath strips the chart-name prefix from template paths like
// "mychart/templates/deployment.yaml" → "templates/deployment.yaml".
func cleanTemplatePath(p string) string {
	parts := strings.SplitN(p, "/", 2)
	if len(parts) == 2 {
		return parts[1]
	}
	return p
}

// extractRegistryCreds maps Trivy-style env vars to username/password.
func extractRegistryCreds(envVars []string) (username, password string) {
	for _, e := range envVars {
		if after, ok := strings.CutPrefix(e, "TRIVY_USERNAME="); ok {
			username = after
		}
		if after, ok := strings.CutPrefix(e, "TRIVY_PASSWORD="); ok {
			password = after
		}
		if after, ok := strings.CutPrefix(e, "TRIVY_REGISTRY_TOKEN="); ok {
			password = after
		}
	}
	return
}

func hasHTTPScheme(value string) bool {
	return strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "http://")
}

func joinOCIChartURL(chartURL, chartName string) string {
	base := strings.TrimRight(strings.TrimSpace(chartURL), "/")
	name := strings.Trim(strings.TrimSpace(chartName), "/")
	if name == "" {
		return base
	}
	if strings.HasSuffix(base, "/"+name) {
		return base
	}
	return base + "/" + name
}

func looksLikeOCIChartURL(chartURL string) bool {
	if chartURL == "" || strings.Contains(chartURL, "://") {
		return false
	}

	host := chartURL
	if idx := strings.Index(host, "/"); idx != -1 {
		host = host[:idx]
	}
	host = strings.ToLower(strings.TrimSpace(host))

	switch host {
	case "localhost", "ghcr.io", "quay.io", "public.ecr.aws", "registry.k8s.io", "docker.io", "index.docker.io", "registry-1.docker.io", "mcr.microsoft.com", "cgr.dev", "gcr.io", "us.gcr.io", "eu.gcr.io", "asia.gcr.io", "k8s.gcr.io":
		return true
	}

	if strings.HasPrefix(host, "localhost:") {
		return true
	}
	if strings.HasSuffix(host, ".pkg.dev") || strings.HasSuffix(host, ".azurecr.io") {
		return true
	}
	if strings.Contains(host, ".dkr.ecr.") && strings.HasSuffix(host, ".amazonaws.com") {
		return true
	}

	return false
}
