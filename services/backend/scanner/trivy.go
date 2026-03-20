package scanner

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
)

type TrivyDatabaseInfo struct {
	Version      string
	UpdatedAt    *time.Time
	NextUpdate   *time.Time
	DownloadedAt *time.Time
}

type TrivyRuntimeInfo struct {
	Version         string
	VulnerabilityDB TrivyDatabaseInfo
	JavaDB          TrivyDatabaseInfo
}

var trivyRefreshLocks sync.Map

// TrivyOutput is the top-level JSON structure from `trivy image --format json`
type TrivyOutput struct {
	SchemaVersion int           `json:"SchemaVersion"`
	ArtifactName  string        `json:"ArtifactName"`
	Metadata      TrivyMetadata `json:"Metadata"`
	Results       []TrivyResult `json:"Results"`
}

type TrivyMetadata struct {
	OS          *TrivyOS          `json:"OS,omitempty"`
	ImageConfig *TrivyImageConfig `json:"ImageConfig,omitempty"`
	ImageID     string            `json:"ImageID,omitempty"`
	RepoTags    []string          `json:"RepoTags,omitempty"`
	RepoDigests []string          `json:"RepoDigests,omitempty"`
}

type TrivyImageConfig struct {
	Architecture string `json:"architecture"`
	OS           string `json:"os"`
}

type TrivyOS struct {
	Family string `json:"Family"`
	Name   string `json:"Name"`
}

type TrivyResult struct {
	Target          string      `json:"Target"`
	Class           string      `json:"Class"`
	Type            string      `json:"Type"`
	Vulnerabilities []TrivyVuln `json:"Vulnerabilities,omitempty"`
}

type TrivyVuln struct {
	VulnerabilityID  string               `json:"VulnerabilityID"`
	PkgName          string               `json:"PkgName"`
	InstalledVersion string               `json:"InstalledVersion"`
	FixedVersion     string               `json:"FixedVersion,omitempty"`
	Title            string               `json:"Title,omitempty"`
	Description      string               `json:"Description,omitempty"`
	Severity         string               `json:"Severity"`
	References       []string             `json:"References,omitempty"`
	CVSS             map[string]TrivyCVSS `json:"CVSS,omitempty"`
	DataSource       *TrivyDataSource     `json:"DataSource,omitempty"`
}

type TrivyCVSS struct {
	V2Vector string  `json:"V2Vector,omitempty"`
	V3Vector string  `json:"V3Vector,omitempty"`
	V2Score  float64 `json:"V2Score,omitempty"`
	V3Score  float64 `json:"V3Score,omitempty"`
}

type TrivyDataSource struct {
	ID   string `json:"ID"`
	Name string `json:"Name"`
	URL  string `json:"URL"`
}

// TrivySBOMOutput holds the CycloneDX SBOM output
type TrivySBOMOutput struct {
	BOMFormat  string          `json:"bomFormat"`
	Components []TrivySBOMComp `json:"components"`
}

type TrivySBOMComp struct {
	Type     string         `json:"type"`
	Name     string         `json:"name"`
	Version  string         `json:"version,omitempty"`
	PURL     string         `json:"purl,omitempty"`
	Licenses []TrivySBOMLic `json:"licenses,omitempty"`
	Supplier *TrivySBOMOrg  `json:"supplier,omitempty"`
}

type TrivySBOMLic struct {
	License *TrivySBOMLicItem `json:"license,omitempty"`
}

type TrivySBOMLicItem struct {
	ID   string `json:"id,omitempty"`
	Name string `json:"name,omitempty"`
}

type TrivySBOMOrg struct {
	Name string `json:"name,omitempty"`
}

// RunScan executes trivy against an image and returns parsed output.
// cacheDir, if non-empty, sets --cache-dir to isolate the trivy DB per worker.
func RunScan(ctx context.Context, imageName, imageTag string, envVars []string, platform, cacheDir string) (*TrivyOutput, string, error) {
	trivyPath := config.Config.Scanner.TrivyPath
	if trivyPath == "" {
		trivyPath = "trivy"
	}
	timeout := config.Config.Scanner.Timeout
	if timeout <= 0 {
		timeout = 300
	}
	scanCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()

	imageRef := imageName
	if imageTag != "" {
		imageRef = imageName + ":" + imageTag
	}
	args := []string{"image", "--format", "json", "--exit-code", "0", "--no-progress"}
	if cacheDir != "" {
		args = append(args, "--cache-dir", cacheDir)
	}
	if platform != "" {
		args = append(args, "--platform", platform)
	}
	args = append(args, imageRef)
	cmd := exec.CommandContext(scanCtx, trivyPath, args...)
	cmd.Env = append(os.Environ(), envVars...)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, "", fmt.Errorf("trivy failed: %w — stderr: %s", err, stderr.String())
	}
	var output TrivyOutput
	if err := json.Unmarshal(stdout.Bytes(), &output); err != nil {
		return nil, "", fmt.Errorf("failed to parse trivy output: %w", err)
	}
	return &output, extractVersion(stderr.String()), nil
}

func EnsureDatabasesFresh(ctx context.Context, cacheDir string) (*TrivyRuntimeInfo, error) {
	if cacheDir == "" {
		cacheDir = trivyCacheRoot()
	}
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create trivy cache dir: %w", err)
	}

	muAny, _ := trivyRefreshLocks.LoadOrStore(cacheDir, &sync.Mutex{})
	mu := muAny.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()

	info, err := GetTrivyRuntimeInfo(ctx, cacheDir)
	if err != nil || shouldRefreshDatabases(info) {
		if err := RefreshTrivyDatabases(ctx, cacheDir); err != nil {
			return nil, err
		}
		info, err = GetTrivyRuntimeInfo(ctx, cacheDir)
		if err != nil {
			return nil, err
		}
	}

	return info, nil
}

func RefreshTrivyDatabases(ctx context.Context, cacheDir string) error {
	trivyPath := config.Config.Scanner.TrivyPath
	if trivyPath == "" {
		trivyPath = "trivy"
	}
	timeout := config.Config.Scanner.Timeout
	if timeout <= 0 {
		timeout = 600
	}
	refreshCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout*2)*time.Second)
	defer cancel()

	commands := [][]string{
		{"image", "--download-db-only", "--quiet"},
		{"image", "--download-java-db-only", "--quiet"},
	}
	for _, args := range commands {
		fullArgs := args
		if cacheDir != "" {
			fullArgs = append([]string{"--cache-dir", cacheDir}, args...)
		}
		cmd := exec.CommandContext(refreshCtx, trivyPath, fullArgs...)
		cmd.Env = os.Environ()
		output, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("trivy db refresh failed for %s: %w — output: %s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
		}
	}
	return nil
}

func GetTrivyRuntimeInfo(ctx context.Context, cacheDir string) (*TrivyRuntimeInfo, error) {
	trivyPath := config.Config.Scanner.TrivyPath
	if trivyPath == "" {
		trivyPath = "trivy"
	}
	timeout := config.Config.Scanner.Timeout
	if timeout <= 0 {
		timeout = 300
	}
	versionCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()

	args := []string{"--version"}
	if cacheDir != "" {
		args = append([]string{"--cache-dir", cacheDir}, args...)
	}
	cmd := exec.CommandContext(versionCtx, trivyPath, args...)
	cmd.Env = os.Environ()
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to read trivy version info: %w — output: %s", err, strings.TrimSpace(string(output)))
	}
	info := parseTrivyRuntimeInfo(string(output))
	if info.Version == "" {
		return nil, fmt.Errorf("failed to parse trivy runtime info")
	}
	return info, nil
}

// RunSBOMScan executes trivy in CycloneDX SBOM mode.
// cacheDir, if non-empty, sets --cache-dir to match the worker's cache directory.
func RunSBOMScan(ctx context.Context, imageName, imageTag string, envVars []string, platform, cacheDir string) (*TrivySBOMOutput, error) {
	trivyPath := config.Config.Scanner.TrivyPath
	if trivyPath == "" {
		trivyPath = "trivy"
	}
	timeout := config.Config.Scanner.Timeout
	if timeout <= 0 {
		timeout = 600
	}
	scanCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()

	imageRef := imageName
	if imageTag != "" {
		imageRef = imageName + ":" + imageTag
	}
	args := []string{"image", "--format", "cyclonedx", "--exit-code", "0", "--no-progress"}
	if cacheDir != "" {
		args = append(args, "--cache-dir", cacheDir)
	}
	if platform != "" {
		args = append(args, "--platform", platform)
	}
	args = append(args, imageRef)
	cmd := exec.CommandContext(scanCtx, trivyPath, args...)
	cmd.Env = append(os.Environ(), envVars...)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("trivy sbom failed: %w — stderr: %s", err, stderr.String())
	}
	var sbom TrivySBOMOutput
	if err := json.Unmarshal(stdout.Bytes(), &sbom); err != nil {
		return nil, fmt.Errorf("failed to parse trivy sbom output: %w", err)
	}
	return &sbom, nil
}

// ParseVulnerabilities converts Trivy output to model Vulnerabilities, deduplicating by VulnID+PkgName.
func ParseVulnerabilities(output *TrivyOutput, scanID uuid.UUID) []models.Vulnerability {
	seen := make(map[string]bool)
	var vulns []models.Vulnerability
	for _, result := range output.Results {
		for _, v := range result.Vulnerabilities {
			key := v.VulnerabilityID + "|" + v.PkgName
			if seen[key] {
				continue
			}
			seen[key] = true
			dataSource := ""
			if v.DataSource != nil {
				dataSource = v.DataSource.Name
			}
			score, vector := extractCVSS(v.CVSS)
			vulns = append(vulns, models.Vulnerability{
				ScanID:           scanID,
				VulnID:           v.VulnerabilityID,
				PkgName:          v.PkgName,
				InstalledVersion: v.InstalledVersion,
				FixedVersion:     v.FixedVersion,
				Severity:         normalizeSeverity(v.Severity),
				Title:            v.Title,
				Description:      v.Description,
				References:       v.References,
				DataSource:       dataSource,
				CVSSScore:        score,
				CVSSVector:       vector,
			})
		}
	}
	return vulns
}

// ParseSBOMComponents converts CycloneDX SBOM to model SBOMComponents.
func ParseSBOMComponents(sbom *TrivySBOMOutput, scanID uuid.UUID) []models.SBOMComponent {
	var components []models.SBOMComponent
	for _, c := range sbom.Components {
		license := ""
		if len(c.Licenses) > 0 && c.Licenses[0].License != nil {
			if c.Licenses[0].License.ID != "" {
				license = c.Licenses[0].License.ID
			} else {
				license = c.Licenses[0].License.Name
			}
		}
		supplier := ""
		if c.Supplier != nil {
			supplier = c.Supplier.Name
		}
		components = append(components, models.SBOMComponent{
			ScanID:     scanID,
			Name:       c.Name,
			Version:    c.Version,
			Type:       c.Type,
			PackageURL: c.PURL,
			License:    license,
			Supplier:   supplier,
		})
	}
	return components
}

// ExtractKBEntries builds a deduplicated slice of VulnKBEntry from a TrivyOutput.
// It collects all references (URL strings from Trivy) and the DataSource as a
// named reference, then assembles CVSS info using the multi-source extractor.
func ExtractKBEntries(output *TrivyOutput) []models.VulnKBEntry {
	seen := make(map[string]*models.VulnKBEntry)
	for _, result := range output.Results {
		for _, v := range result.Vulnerabilities {
			id := v.VulnerabilityID
			if id == "" {
				continue
			}
			entry, exists := seen[id]
			if !exists {
				score, vector := extractCVSS(v.CVSS)
				// Build references from URLs + data source
				var refs []models.KBRef
				for _, ref := range v.References {
					if ref != "" {
						refs = append(refs, models.KBRef{URL: ref})
					}
				}
				if v.DataSource != nil && v.DataSource.URL != "" {
					refs = append(refs, models.KBRef{
						URL:    v.DataSource.URL,
						Source: v.DataSource.Name,
					})
				}
				// Detect exploit hint from references (GitHub PoC / exploit-db patterns)
				exploitAvailable := false
				for _, r := range refs {
					url := strings.ToLower(r.URL)
					if strings.Contains(url, "exploit-db.com") ||
						strings.Contains(url, "packetstormsecurity") ||
						strings.Contains(url, "github.com/exploit") ||
						strings.Contains(url, "exploit") {
						exploitAvailable = true
						break
					}
				}
				entry = &models.VulnKBEntry{
					VulnID:           id,
					Description:      v.Description,
					Severity:         normalizeSeverity(v.Severity),
					CVSSScore:        score,
					CVSSVector:       vector,
					References:       refs,
					ExploitAvailable: exploitAvailable,
				}
				seen[id] = entry
			} else {
				// Merge: keep best score
				score, vector := extractCVSS(v.CVSS)
				if score > entry.CVSSScore {
					entry.CVSSScore = score
					entry.CVSSVector = vector
				}
			}
		}
	}
	entries := make([]models.VulnKBEntry, 0, len(seen))
	for _, e := range seen {
		entries = append(entries, *e)
	}
	return entries
}

// CountSeverities counts vulnerabilities by severity.
func CountSeverities(vulns []models.Vulnerability) map[string]int {
	counts := map[string]int{
		models.SeverityCritical: 0,
		models.SeverityHigh:     0,
		models.SeverityMedium:   0,
		models.SeverityLow:      0,
		models.SeverityUnknown:  0,
	}
	for _, v := range vulns {
		if _, ok := counts[v.Severity]; ok {
			counts[v.Severity]++
		} else {
			counts[models.SeverityUnknown]++
		}
	}
	return counts
}

// ExtractDigest gets the first repo digest from trivy metadata.
func ExtractDigest(output *TrivyOutput) string {
	for _, d := range output.Metadata.RepoDigests {
		if idx := strings.Index(d, "@"); idx != -1 {
			return d[idx+1:]
		}
	}
	return output.Metadata.ImageID
}

func normalizeSeverity(s string) string {
	switch strings.ToUpper(s) {
	case "CRITICAL":
		return models.SeverityCritical
	case "HIGH":
		return models.SeverityHigh
	case "MEDIUM":
		return models.SeverityMedium
	case "LOW":
		return models.SeverityLow
	default:
		return models.SeverityUnknown
	}
}

func trivyCacheRoot() string {
	if cacheDir := os.Getenv("TRIVY_CACHE_DIR"); cacheDir != "" {
		return cacheDir
	}
	if _, err := os.Stat("/app/data"); err == nil {
		return filepath.Join("/app/data", "trivy-cache")
	}
	return filepath.Join(os.TempDir(), "justscan-trivy")
}

func workerCacheDir(workerID int) string {
	return filepath.Join(trivyCacheRoot(), fmt.Sprintf("worker-%d", workerID))
}

func shouldRefreshDatabases(info *TrivyRuntimeInfo) bool {
	if info == nil {
		return true
	}
	maxAge := time.Duration(config.Config.Scanner.DBMaxAgeHours) * time.Hour
	if maxAge <= 0 {
		maxAge = 24 * time.Hour
	}
	now := time.Now()
	return dbNeedsRefresh(info.VulnerabilityDB, now, maxAge) || dbNeedsRefresh(info.JavaDB, now, maxAge)
}

func dbNeedsRefresh(info TrivyDatabaseInfo, now time.Time, maxAge time.Duration) bool {
	if info.UpdatedAt == nil || info.DownloadedAt == nil {
		return true
	}
	if now.Sub(*info.UpdatedAt) > maxAge {
		return true
	}
	if info.NextUpdate != nil && now.After(*info.NextUpdate) {
		return true
	}
	return false
}

func parseTrivyRuntimeInfo(raw string) *TrivyRuntimeInfo {
	info := &TrivyRuntimeInfo{}
	section := ""
	scanner := bufio.NewScanner(strings.NewReader(raw))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		switch line {
		case "Vulnerability DB:":
			section = "vuln"
			continue
		case "Java DB:":
			section = "java"
			continue
		}

		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if section == "" {
			if key == "Version" {
				info.Version = value
			}
			continue
		}
		db := &info.VulnerabilityDB
		if section == "java" {
			db = &info.JavaDB
		}
		switch key {
		case "Version":
			db.Version = value
		case "UpdatedAt":
			db.UpdatedAt = parseTrivyTimestamp(value)
		case "NextUpdate":
			db.NextUpdate = parseTrivyTimestamp(value)
		case "DownloadedAt":
			db.DownloadedAt = parseTrivyTimestamp(value)
		}
	}
	return info
}

func parseTrivyTimestamp(value string) *time.Time {
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.999999999 -0700 MST",
		"2006-01-02 15:04:05 -0700 MST",
		"2006-01-02 15:04:05.999999999 -0700 -0700",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			return &parsed
		}
	}
	return nil
}

// preferredCVSSSources lists data source keys in descending preference order.
// Trivy uses these as keys in the CVSS map.
var preferredCVSSSources = []string{
	"nvd", "NVD", // National Vulnerability Database
	"ghsa", "GHSA", // GitHub Security Advisories
	"osv", "OSV", // Open Source Vulnerabilities
	"redhat", "RedHat", // Red Hat Security
	"debian", "Debian", // Debian Security
	"ubuntu", "Ubuntu", // Ubuntu Security
	"alpine", "Alpine", // Alpine SecDB
	"amazon", "Amazon", // Amazon Linux
	"oracle", "Oracle", // Oracle Linux OVAL
	"suse", "SUSE", // SUSE OVAL
}

func extractCVSS(cvss map[string]TrivyCVSS) (float64, string) {
	// Try preferred sources first
	for _, key := range preferredCVSSSources {
		if c, ok := cvss[key]; ok {
			if c.V3Score > 0 {
				return c.V3Score, c.V3Vector
			}
			if c.V2Score > 0 {
				return c.V2Score, c.V2Vector
			}
		}
	}
	// Fall back to any available source
	for _, c := range cvss {
		if c.V3Score > 0 {
			return c.V3Score, c.V3Vector
		}
		if c.V2Score > 0 {
			return c.V2Score, c.V2Vector
		}
	}
	return 0, ""
}

func extractVersion(stderr string) string {
	for _, line := range strings.Split(stderr, "\n") {
		if strings.Contains(line, "Version:") {
			parts := strings.SplitN(line, "Version:", 2)
			if len(parts) == 2 {
				return strings.TrimSpace(parts[1])
			}
		}
	}
	return ""
}
