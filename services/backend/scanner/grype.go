package scanner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
)

type GrypeOutput struct {
	Matches    []GrypeMatch    `json:"matches"`
	Descriptor GrypeDescriptor `json:"descriptor"`
}

type GrypeDescriptor struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type GrypeMatch struct {
	Vulnerability          GrypeVulnerability           `json:"vulnerability"`
	RelatedVulnerabilities []GrypeVulnerabilityMetadata `json:"relatedVulnerabilities"`
	Artifact               GrypeArtifact                `json:"artifact"`
}

type GrypeArtifact struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type GrypeVulnerability struct {
	GrypeVulnerabilityMetadata
	Fix        GrypeFix        `json:"fix"`
	Advisories []GrypeAdvisory `json:"advisories"`
}

type GrypeFix struct {
	Versions []string `json:"versions"`
	State    string   `json:"state"`
}

type GrypeAdvisory struct {
	ID   string `json:"id"`
	Link string `json:"link"`
}

type GrypeVulnerabilityMetadata struct {
	ID          string      `json:"id"`
	DataSource  string      `json:"dataSource"`
	Namespace   string      `json:"namespace,omitempty"`
	Severity    string      `json:"severity,omitempty"`
	URLs        []string    `json:"urls"`
	Description string      `json:"description,omitempty"`
	Cvss        []GrypeCVSS `json:"cvss"`
}

type GrypeCVSS struct {
	Source  string           `json:"source,omitempty"`
	Type    string           `json:"type,omitempty"`
	Version string           `json:"version"`
	Vector  string           `json:"vector"`
	Metrics GrypeCVSSMetrics `json:"metrics"`
}

type GrypeCVSSMetrics struct {
	BaseScore float64 `json:"baseScore"`
}

func RunGrypeScan(ctx context.Context, imageName, imageTag string, envVars []string, platform, workerCacheDir string) (*GrypeOutput, string, error) {
	grypePath := config.Config.Scanner.GrypePath
	if grypePath == "" {
		grypePath = "grype"
	}
	timeout := config.Config.Scanner.Timeout
	if timeout <= 0 {
		timeout = 300
	}

	cacheDir := workerGrypeCacheDir(workerCacheDir)
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return nil, "", fmt.Errorf("failed to create grype cache dir: %w", err)
	}

	scanCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()

	imageRef := buildImageRef(imageName, imageTag)
	args := []string{"-o", "json"}
	if platform != "" {
		args = append(args, "--platform", platform)
	}
	args = append(args, "registry:"+imageRef)

	cmd := exec.CommandContext(scanCtx, grypePath, args...)
	cmd.Env = buildGrypeCommandEnv(imageName, envVars, cacheDir)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, "", fmt.Errorf("grype failed: %w — stderr: %s", err, stderr.String())
	}

	var output GrypeOutput
	if err := json.Unmarshal(stdout.Bytes(), &output); err != nil {
		return nil, "", fmt.Errorf("failed to parse grype output: %w", err)
	}

	return &output, strings.TrimSpace(output.Descriptor.Version), nil
}

func ParseGrypeVulnerabilities(output *GrypeOutput, scanID uuid.UUID) []models.Vulnerability {
	if output == nil {
		return nil
	}

	seen := make(map[string]bool)
	vulns := make([]models.Vulnerability, 0, len(output.Matches))
	for _, match := range output.Matches {
		vulnID := grypeCanonicalVulnerabilityID(match)
		pkgName := strings.TrimSpace(match.Artifact.Name)
		if vulnID == "" || pkgName == "" {
			continue
		}

		key := vulnID + "|" + pkgName
		if seen[key] {
			continue
		}
		seen[key] = true

		metadata := grypeMetadataCandidates(match)
		refs := grypeReferenceURLs(match, metadata)
		score, vector := grypeBestCVSS(metadata)

		vulns = append(vulns, models.Vulnerability{
			ScanID:           scanID,
			VulnID:           vulnID,
			PkgName:          pkgName,
			InstalledVersion: strings.TrimSpace(match.Artifact.Version),
			FixedVersion:     strings.Join(grypeFixedVersions(match.Vulnerability.Fix.Versions), ", "),
			Severity:         grypeBestSeverity(metadata),
			Title:            "",
			Description:      grypeBestDescription(metadata, vulnID),
			References:       refs,
			DataSource:       grypeBestSource(metadata, vulnID),
			CVSSScore:        score,
			CVSSVector:       vector,
		})
	}

	return vulns
}

func ExtractGrypeKBEntries(output *GrypeOutput) []models.VulnKBEntry {
	if output == nil {
		return nil
	}

	seen := make(map[string]*models.VulnKBEntry)
	for _, match := range output.Matches {
		vulnID := grypeCanonicalVulnerabilityID(match)
		if vulnID == "" {
			continue
		}

		metadata := grypeMetadataCandidates(match)
		refs := grypeKBReferences(match, metadata)
		score, vector := grypeBestCVSS(metadata)

		entry, exists := seen[vulnID]
		if !exists {
			entry = &models.VulnKBEntry{
				VulnID:           vulnID,
				Description:      grypeBestDescription(metadata, vulnID),
				Severity:         grypeBestSeverity(metadata),
				CVSSScore:        score,
				CVSSVector:       vector,
				References:       refs,
				ExploitAvailable: kbRefsContainExploit(refs),
			}
			seen[vulnID] = entry
			continue
		}

		entry.References = mergeKBRefs(entry.References, refs)
		entry.ExploitAvailable = entry.ExploitAvailable || kbRefsContainExploit(refs)
		if score > entry.CVSSScore {
			entry.CVSSScore = score
			entry.CVSSVector = vector
		}
		if severityRank(grypeBestSeverity(metadata)) > severityRank(entry.Severity) {
			entry.Severity = grypeBestSeverity(metadata)
		}
		if len(strings.TrimSpace(grypeBestDescription(metadata, vulnID))) > len(strings.TrimSpace(entry.Description)) {
			entry.Description = grypeBestDescription(metadata, vulnID)
		}
	}

	entries := make([]models.VulnKBEntry, 0, len(seen))
	for _, entry := range seen {
		entries = append(entries, *entry)
	}
	return entries
}

func MergeLocalScannerFindings(existing, incoming []models.Vulnerability) []models.Vulnerability {
	if len(incoming) == 0 {
		return existing
	}

	merged := append([]models.Vulnerability(nil), existing...)
	byKey := make(map[string]int, len(merged))
	for idx, vuln := range merged {
		byKey[vulnerabilityMergeKey(vuln)] = idx
	}

	for _, vuln := range incoming {
		key := vulnerabilityMergeKey(vuln)
		if idx, ok := byKey[key]; ok {
			merged[idx] = mergeVulnerabilityRecord(merged[idx], vuln)
			continue
		}
		byKey[key] = len(merged)
		merged = append(merged, vuln)
	}

	return merged
}

func MergeKBEntries(existing, incoming []models.VulnKBEntry) []models.VulnKBEntry {
	if len(incoming) == 0 {
		return existing
	}

	merged := append([]models.VulnKBEntry(nil), existing...)
	byID := make(map[string]int, len(merged))
	for idx, entry := range merged {
		byID[entry.VulnID] = idx
	}

	for _, entry := range incoming {
		if idx, ok := byID[entry.VulnID]; ok {
			merged[idx] = mergeKBEntry(merged[idx], entry)
			continue
		}
		byID[entry.VulnID] = len(merged)
		merged = append(merged, entry)
	}

	return merged
}

func mergeKBEntry(base, incoming models.VulnKBEntry) models.VulnKBEntry {
	if len(strings.TrimSpace(incoming.Description)) > len(strings.TrimSpace(base.Description)) {
		base.Description = incoming.Description
	}
	if severityRank(incoming.Severity) > severityRank(base.Severity) {
		base.Severity = incoming.Severity
	}
	if incoming.CVSSScore > base.CVSSScore {
		base.CVSSScore = incoming.CVSSScore
		base.CVSSVector = incoming.CVSSVector
	}
	if base.PublishedDate == nil {
		base.PublishedDate = incoming.PublishedDate
	}
	if base.ModifiedDate == nil {
		base.ModifiedDate = incoming.ModifiedDate
	}
	base.References = mergeKBRefs(base.References, incoming.References)
	base.ExploitAvailable = base.ExploitAvailable || incoming.ExploitAvailable
	return base
}

func mergeVulnerabilityRecord(base, incoming models.Vulnerability) models.Vulnerability {
	if incoming.InstalledVersion != "" && base.InstalledVersion == "" {
		base.InstalledVersion = incoming.InstalledVersion
	}
	if incoming.FixedVersion != "" && base.FixedVersion == "" {
		base.FixedVersion = incoming.FixedVersion
	}
	if incoming.Title != "" && base.Title == "" {
		base.Title = incoming.Title
	}
	if len(strings.TrimSpace(incoming.Description)) > len(strings.TrimSpace(base.Description)) {
		base.Description = incoming.Description
	}
	if incoming.DataSource != "" && base.DataSource == "" {
		base.DataSource = incoming.DataSource
	}
	if severityRank(incoming.Severity) > severityRank(base.Severity) {
		base.Severity = incoming.Severity
	}
	if incoming.CVSSScore > base.CVSSScore {
		base.CVSSScore = incoming.CVSSScore
		base.CVSSVector = incoming.CVSSVector
	}
	base.References = mergeReferenceURLs(base.References, incoming.References)
	return base
}

func vulnerabilityMergeKey(vuln models.Vulnerability) string {
	return strings.TrimSpace(vuln.VulnID) + "|" + strings.TrimSpace(vuln.PkgName)
}

func mergeReferenceURLs(existing, incoming []string) []string {
	if len(existing) == 0 {
		return append([]string(nil), incoming...)
	}
	if len(incoming) == 0 {
		return append([]string(nil), existing...)
	}

	merged := make([]string, 0, len(existing)+len(incoming))
	seen := make(map[string]bool, len(existing)+len(incoming))
	appendURL := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		merged = append(merged, value)
	}
	for _, value := range existing {
		appendURL(value)
	}
	for _, value := range incoming {
		appendURL(value)
	}
	return merged
}

func workerGrypeCacheDir(workerCacheDir string) string {
	return filepath.Join(workerCacheDir, "grype-db")
}

func buildGrypeCommandEnv(imageName string, envVars []string, cacheDir string) []string {
	env := append([]string{}, os.Environ()...)
	extra := []string{
		"GRYPE_CHECK_FOR_APP_UPDATE=false",
		"GRYPE_DB_CACHE_DIR=" + cacheDir,
	}

	authority := registryAuthorityFromImage(imageName)
	useRegistryAuth := false
	for _, entry := range envVars {
		switch {
		case strings.HasPrefix(entry, "TRIVY_USERNAME="):
			useRegistryAuth = true
			extra = append(extra, "GRYPE_REGISTRY_AUTH_USERNAME="+strings.TrimPrefix(entry, "TRIVY_USERNAME="))
		case strings.HasPrefix(entry, "TRIVY_PASSWORD="):
			useRegistryAuth = true
			extra = append(extra, "GRYPE_REGISTRY_AUTH_PASSWORD="+strings.TrimPrefix(entry, "TRIVY_PASSWORD="))
		case strings.HasPrefix(entry, "TRIVY_REGISTRY_TOKEN="):
			useRegistryAuth = true
			extra = append(extra, "GRYPE_REGISTRY_AUTH_TOKEN="+strings.TrimPrefix(entry, "TRIVY_REGISTRY_TOKEN="))
		default:
			extra = append(extra, entry)
		}
	}

	if useRegistryAuth && authority != "" {
		extra = append(extra, "GRYPE_REGISTRY_AUTH_AUTHORITY="+authority)
	}

	return append(env, extra...)
}

func registryAuthorityFromImage(imageName string) string {
	if !hasRegistryHost(imageName) {
		return ""
	}
	firstSegment := imageName
	if slash := strings.Index(firstSegment, "/"); slash != -1 {
		firstSegment = firstSegment[:slash]
	}
	return strings.TrimSpace(firstSegment)
}

func grypeMetadataCandidates(match GrypeMatch) []GrypeVulnerabilityMetadata {
	metadata := make([]GrypeVulnerabilityMetadata, 0, 1+len(match.RelatedVulnerabilities))
	metadata = append(metadata, match.Vulnerability.GrypeVulnerabilityMetadata)
	metadata = append(metadata, match.RelatedVulnerabilities...)
	return metadata
}

func grypeCanonicalVulnerabilityID(match GrypeMatch) string {
	if isCVEIdentifier(match.Vulnerability.ID) {
		return strings.TrimSpace(match.Vulnerability.ID)
	}
	for _, related := range match.RelatedVulnerabilities {
		if isCVEIdentifier(related.ID) {
			return strings.TrimSpace(related.ID)
		}
	}
	if strings.TrimSpace(match.Vulnerability.ID) != "" {
		return strings.TrimSpace(match.Vulnerability.ID)
	}
	for _, related := range match.RelatedVulnerabilities {
		if strings.TrimSpace(related.ID) != "" {
			return strings.TrimSpace(related.ID)
		}
	}
	return ""
}

func isCVEIdentifier(id string) bool {
	id = strings.ToUpper(strings.TrimSpace(id))
	return strings.HasPrefix(id, "CVE-")
}

func grypeBestSeverity(metadata []GrypeVulnerabilityMetadata) string {
	best := models.SeverityUnknown
	for _, item := range metadata {
		severity := normalizeSeverity(item.Severity)
		if severityRank(severity) > severityRank(best) {
			best = severity
		}
	}
	return best
}

func grypeBestDescription(metadata []GrypeVulnerabilityMetadata, preferredID string) string {
	preferredID = strings.TrimSpace(preferredID)
	for _, item := range metadata {
		if strings.TrimSpace(item.ID) == preferredID && strings.TrimSpace(item.Description) != "" {
			return item.Description
		}
	}
	best := ""
	for _, item := range metadata {
		if len(strings.TrimSpace(item.Description)) > len(strings.TrimSpace(best)) {
			best = item.Description
		}
	}
	return best
}

func grypeBestSource(metadata []GrypeVulnerabilityMetadata, preferredID string) string {
	preferredID = strings.TrimSpace(preferredID)
	for _, item := range metadata {
		if strings.TrimSpace(item.ID) == preferredID {
			if strings.TrimSpace(item.Namespace) != "" {
				return strings.TrimSpace(item.Namespace)
			}
			if strings.TrimSpace(item.DataSource) != "" {
				return strings.TrimSpace(item.DataSource)
			}
		}
	}
	for _, item := range metadata {
		if strings.TrimSpace(item.Namespace) != "" {
			return strings.TrimSpace(item.Namespace)
		}
	}
	for _, item := range metadata {
		if strings.TrimSpace(item.DataSource) != "" {
			return strings.TrimSpace(item.DataSource)
		}
	}
	return "grype"
}

func grypeBestCVSS(metadata []GrypeVulnerabilityMetadata) (float64, string) {
	bestScore := 0.0
	bestVector := ""
	for _, item := range metadata {
		for _, cvss := range item.Cvss {
			if cvss.Metrics.BaseScore > bestScore {
				bestScore = cvss.Metrics.BaseScore
				bestVector = cvss.Vector
			}
		}
	}
	return bestScore, bestVector
}

func grypeReferenceURLs(match GrypeMatch, metadata []GrypeVulnerabilityMetadata) []string {
	refs := make([]string, 0)
	for _, item := range metadata {
		if strings.TrimSpace(item.DataSource) != "" {
			refs = append(refs, strings.TrimSpace(item.DataSource))
		}
		refs = append(refs, item.URLs...)
	}
	for _, advisory := range match.Vulnerability.Advisories {
		if strings.TrimSpace(advisory.Link) != "" {
			refs = append(refs, strings.TrimSpace(advisory.Link))
		}
	}
	return mergeReferenceURLs(nil, refs)
}

func grypeKBReferences(match GrypeMatch, metadata []GrypeVulnerabilityMetadata) []models.KBRef {
	refs := make([]models.KBRef, 0)
	for _, item := range metadata {
		source := strings.TrimSpace(item.Namespace)
		if source == "" {
			source = "grype"
		}
		if strings.TrimSpace(item.DataSource) != "" {
			refs = append(refs, models.KBRef{URL: strings.TrimSpace(item.DataSource), Source: source})
		}
		for _, url := range item.URLs {
			refs = append(refs, models.KBRef{URL: strings.TrimSpace(url), Source: source})
		}
	}
	for _, advisory := range match.Vulnerability.Advisories {
		source := strings.TrimSpace(advisory.ID)
		if source == "" {
			source = "grype-advisory"
		}
		refs = append(refs, models.KBRef{URL: strings.TrimSpace(advisory.Link), Source: source})
	}
	return mergeKBRefs(nil, refs)
}

func grypeFixedVersions(versions []string) []string {
	if len(versions) == 0 {
		return nil
	}
	unique := make(map[string]bool, len(versions))
	normalized := make([]string, 0, len(versions))
	for _, version := range versions {
		version = strings.TrimSpace(version)
		if version == "" || unique[version] {
			continue
		}
		unique[version] = true
		normalized = append(normalized, version)
	}
	sort.Strings(normalized)
	return normalized
}

func severityRank(severity string) int {
	switch normalizeSeverity(severity) {
	case models.SeverityCritical:
		return 4
	case models.SeverityHigh:
		return 3
	case models.SeverityMedium:
		return 2
	case models.SeverityLow:
		return 1
	default:
		return 0
	}
}
