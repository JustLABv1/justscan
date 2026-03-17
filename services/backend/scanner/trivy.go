package scanner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
)

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
func RunScan(ctx context.Context, imageName, imageTag string, envVars []string, platform string) (*TrivyOutput, string, error) {
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

// RunSBOMScan executes trivy in CycloneDX SBOM mode.
func RunSBOMScan(ctx context.Context, imageName, imageTag string, envVars []string, platform string) (*TrivySBOMOutput, error) {
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

func extractCVSS(cvss map[string]TrivyCVSS) (float64, string) {
	for _, key := range []string{"nvd", "NVD"} {
		if c, ok := cvss[key]; ok {
			if c.V3Score > 0 {
				return c.V3Score, c.V3Vector
			}
			if c.V2Score > 0 {
				return c.V2Score, c.V2Vector
			}
		}
	}
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
