package scanner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"justscan-backend/compliance"
	"justscan-backend/notifications"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

const xrayDataSource = "JFrog Xray"

const xrayRequestTimeout = 90 * time.Second
const xraySummaryPollInterval = 10 * time.Second
const xraySummaryWaitWindow = 15 * time.Minute

type xrayClient struct {
	baseURL       string
	artifactoryID string
	authType      string
	username      string
	secret        string
	httpClient    *http.Client
}

type RegistryXrayTestClient struct {
	client *xrayClient
}

type xrayHTTPError struct {
	StatusCode int
	Body       string
}

func (e *xrayHTTPError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("xray API returned HTTP %d", e.StatusCode)
	}
	return fmt.Sprintf("xray API returned HTTP %d: %s", e.StatusCode, e.Body)
}

type xraySummaryResponse struct {
	Artifacts []xraySummaryArtifact `json:"artifacts"`
}

type xraySummaryArtifact struct {
	Issues []xraySummaryIssue `json:"issues"`
}

type xraySummaryIssue struct {
	IssueID     string                 `json:"issue_id"`
	Summary     string                 `json:"summary"`
	Description string                 `json:"description"`
	Severity    string                 `json:"severity"`
	Components  []xraySummaryComponent `json:"components"`
	CVEs        []xraySummaryCVE       `json:"cves"`
	References  []any                  `json:"references"`
}

type xraySummaryComponent struct {
	Name          string   `json:"name"`
	Version       string   `json:"version"`
	ComponentID   string   `json:"component_id"`
	FixedVersions []string `json:"fixed_versions"`
}

type xraySummaryCVE struct {
	CVE          string  `json:"cve"`
	CVSSV3Score  float64 `json:"cvss_v3_score"`
	CVSSV3Vector string  `json:"cvss_v3_vector"`
	CVSSScore    float64 `json:"cvss_score"`
	CVSSVector   string  `json:"cvss_vector"`
}

func processXrayScan(ctx context.Context, db *bun.DB, scan *models.Scan) error {
	if scan.RegistryID == nil {
		return fmt.Errorf("xray scans require a registry selection")
	}

	registry := &models.Registry{}
	if err := db.NewSelect().Model(registry).Where("id = ?", *scan.RegistryID).Scan(ctx); err != nil {
		return fmt.Errorf("failed to load registry for xray scan: %w", err)
	}

	client, err := newXrayClient(registry)
	if err != nil {
		return err
	}

	repoPath, artifactPath, err := xrayArtifactPaths(scan.ImageName, scan.ImageTag, registry, client.artifactoryID)
	if err != nil {
		return err
	}

	componentID := "docker://" + buildImageRef(scan.ImageName, scan.ImageTag)
	if err := updateXrayMetadata(ctx, db, scan.ID, componentID, "indexing"); err != nil {
		return err
	}
	scan.ExternalScanID = componentID
	scan.ExternalStatus = "indexing"

	if err := client.scanNow(ctx, repoPath); err != nil {
		// Scan Artifact can still succeed for already-indexed images.
		// Keep going so Xray-backed scans remain usable across setups.
	}

	if err := updateXrayMetadata(ctx, db, scan.ID, componentID, "queued"); err != nil {
		return err
	}
	scan.ExternalStatus = "queued"

	if err := client.scanArtifact(ctx, componentID); err != nil {
		if !isRetriableXrayScanArtifactError(err) {
			return err
		}
		log.Warnf("Xray scanArtifact returned a non-fatal error for scan %s (%s); continuing to poll artifact summary: %v", scan.ID, componentID, err)
	}

	if err := updateXrayMetadata(ctx, db, scan.ID, componentID, "waiting_for_xray"); err != nil {
		return err
	}
	scan.ExternalStatus = "waiting_for_xray"

	summary, err := client.pollArtifactSummary(ctx, artifactPath)
	if err != nil {
		return err
	}

	if err := updateXrayMetadata(ctx, db, scan.ID, componentID, "importing"); err != nil {
		return err
	}
	scan.ExternalStatus = "importing"

	vulns := ParseXrayVulnerabilities(summary, scan.ID)
	if len(vulns) > 0 {
		if _, err := db.NewInsert().Model(&vulns).Exec(ctx); err != nil {
			return fmt.Errorf("failed to store xray vulnerabilities: %w", err)
		}
	}

	severityCounts := CountSeverities(vulns)
	completedAt := time.Now()
	scan.Status = models.ScanStatusCompleted
	scan.CompletedAt = &completedAt
	scan.CriticalCount = severityCounts[models.SeverityCritical]
	scan.HighCount = severityCounts[models.SeverityHigh]
	scan.MediumCount = severityCounts[models.SeverityMedium]
	scan.LowCount = severityCounts[models.SeverityLow]
	scan.UnknownCount = severityCounts[models.SeverityUnknown]
	scan.ExternalStatus = "completed"

	if _, err := db.NewUpdate().Model(scan).
		Column("status", "completed_at", "critical_count", "high_count", "medium_count", "low_count", "unknown_count", "external_scan_id", "external_status").
		Where("id = ?", scan.ID).
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to mark xray scan as completed: %w", err)
	}

	go compliance.AutoAssignOrgs(db, scan.ImageName, scan.ImageTag, scan.ID)
	go applyAutoTags(db, scan)
	go notifications.Dispatch(db, models.NotificationEventScanComplete, notifications.Payload{
		ScanID:    scan.ID.String(),
		ImageName: scan.ImageName,
		ImageTag:  scan.ImageTag,
		Status:    models.ScanStatusCompleted,
		Details: fmt.Sprintf("Critical: %d  High: %d  Medium: %d  Low: %d",
			scan.CriticalCount, scan.HighCount, scan.MediumCount, scan.LowCount),
	})

	return nil
}

func newXrayClient(registry *models.Registry) (*xrayClient, error) {
	secret, err := decryptRegistrySecret(registry)
	if err != nil {
		return nil, err
	}

	baseURL := strings.TrimSpace(registry.XrayURL)
	if baseURL == "" {
		baseURL = strings.TrimSpace(registry.URL)
	}
	baseURL = strings.TrimRight(baseURL, "/")
	if baseURL == "" {
		return nil, fmt.Errorf("registry %s is missing an Xray base URL", registry.Name)
	}

	artifactoryID := strings.TrimSpace(registry.XrayArtifactoryID)
	if artifactoryID == "" {
		artifactoryID = "default"
	}

	return &xrayClient{
		baseURL:       baseURL,
		artifactoryID: artifactoryID,
		authType:      registry.AuthType,
		username:      registry.Username,
		secret:        secret,
		httpClient:    &http.Client{Timeout: xrayRequestTimeout},
	}, nil
}

func NewRegistryXrayTestClient(registry *models.Registry) (*RegistryXrayTestClient, error) {
	client, err := newXrayClient(registry)
	if err != nil {
		return nil, err
	}
	return &RegistryXrayTestClient{client: client}, nil
}

func (c *RegistryXrayTestClient) Ping(ctx context.Context) error {
	return c.client.ping(ctx)
}

func (c *xrayClient) ping(ctx context.Context) error {
	_, err := c.doJSON(ctx, http.MethodGet, "/xray/api/v1/system/ping", nil, nil, http.StatusOK)
	return err
}

func (c *xrayClient) scanNow(ctx context.Context, repoPath string) error {
	_, err := c.doJSON(ctx, http.MethodPost, "/xray/api/v2/index", map[string]string{
		"repo_path": repoPath,
	}, nil, http.StatusOK)
	return err
}

func (c *xrayClient) scanArtifact(ctx context.Context, componentID string) error {
	_, err := c.doJSON(ctx, http.MethodPost, "/xray/api/v1/scanArtifact", map[string]string{
		"componentID": componentID,
	}, nil, http.StatusOK)
	return err
}

func (c *xrayClient) artifactSummary(ctx context.Context, artifactPath string) (*xraySummaryResponse, error) {
	var response xraySummaryResponse
	_, err := c.doJSON(ctx, http.MethodPost, "/xray/api/v2/summary/artifact", map[string][]string{
		"paths": {artifactPath},
	}, &response, http.StatusOK)
	if err != nil {
		return nil, err
	}
	return &response, nil
}

func (c *xrayClient) pollArtifactSummary(ctx context.Context, artifactPath string) (*xraySummaryResponse, error) {
	deadline := time.Now().Add(xraySummaryWaitWindow)
	for {
		summary, err := c.artifactSummary(ctx, artifactPath)
		if err == nil {
			if len(summary.Artifacts) > 0 {
				return summary, nil
			}
		} else {
			var httpErr *xrayHTTPError
			if !errors.As(err, &httpErr) || (httpErr.StatusCode != http.StatusNotFound && httpErr.StatusCode != http.StatusBadRequest) {
				return nil, err
			}
		}

		if time.Now().After(deadline) {
			return nil, fmt.Errorf("timed out after %s waiting for xray results for %s", xraySummaryWaitWindow, artifactPath)
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(xraySummaryPollInterval):
		}
	}
}

func (c *xrayClient) doJSON(ctx context.Context, method, path string, body any, out any, allowedStatus ...int) ([]byte, error) {
	var requestBody io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal xray request: %w", err)
		}
		requestBody = bytes.NewReader(payload)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, requestBody)
	if err != nil {
		return nil, fmt.Errorf("failed to build xray request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	applyXrayAuth(req, c.authType, c.username, c.secret)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("xray request failed: %w", err)
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read xray response: %w", err)
	}

	for _, allowed := range allowedStatus {
		if resp.StatusCode == allowed {
			if out != nil && len(responseBody) > 0 {
				if err := json.Unmarshal(responseBody, out); err != nil {
					return nil, fmt.Errorf("failed to decode xray response: %w", err)
				}
			}
			return responseBody, nil
		}
	}

	return nil, &xrayHTTPError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(responseBody))}
}

func applyXrayAuth(req *http.Request, authType, username, secret string) {
	switch authType {
	case models.RegistryAuthBasic:
		req.SetBasicAuth(username, secret)
	case models.RegistryAuthToken:
		req.Header.Set("Authorization", "Bearer "+secret)
	}
}

func xrayArtifactPaths(imageName, imageTag string, registry *models.Registry, artifactoryID string) (string, string, error) {
	imagePath := strings.TrimSpace(imageName)
	registryHost := normalizeRegistryHost(registry.URL)
	if registryHost != "" && strings.HasPrefix(imagePath, registryHost+"/") {
		imagePath = strings.TrimPrefix(imagePath, registryHost+"/")
	}
	imagePath = strings.TrimPrefix(imagePath, "/")

	parts := strings.Split(imagePath, "/")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("image %q must include an Artifactory repository key when using Xray", imageName)
	}

	repo := parts[0]
	artifactName := strings.Join(parts[1:], "/")
	tag := strings.TrimPrefix(strings.TrimSpace(imageTag), ":")
	if tag == "" {
		return "", "", fmt.Errorf("image tag is required for xray scans")
	}

	repoPath := repo + "/" + artifactName + "/" + tag + "/manifest.json"
	artifactPath := artifactoryID + "/" + repoPath
	return repoPath, artifactPath, nil
}

func updateXrayMetadata(ctx context.Context, db *bun.DB, scanID uuid.UUID, externalScanID, externalStatus string) error {
	_, err := db.NewUpdate().Model((*models.Scan)(nil)).
		Set("external_scan_id = ?", externalScanID).
		Set("external_status = ?", externalStatus).
		Where("id = ?", scanID).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to update xray metadata for scan %s: %w", scanID, err)
	}
	return nil
}

func ParseXrayVulnerabilities(summary *xraySummaryResponse, scanID uuid.UUID) []models.Vulnerability {
	seen := make(map[string]bool)
	vulns := make([]models.Vulnerability, 0)

	for _, artifact := range summary.Artifacts {
		for _, issue := range artifact.Issues {
			components := issue.Components
			if len(components) == 0 {
				components = []xraySummaryComponent{{}}
			}

			for _, component := range components {
				vulnID := xrayIssueID(issue)
				pkgName := xrayPackageName(component)
				key := vulnID + "|" + pkgName + "|" + component.Version
				if seen[key] {
					continue
				}
				seen[key] = true

				score, vector := xrayIssueScore(issue)
				vulns = append(vulns, models.Vulnerability{
					ScanID:           scanID,
					VulnID:           vulnID,
					PkgName:          pkgName,
					InstalledVersion: component.Version,
					FixedVersion:     strings.Join(component.FixedVersions, ", "),
					Severity:         normalizeXraySeverity(issue.Severity),
					Title:            issue.Summary,
					Description:      issue.Description,
					References:       xrayReferences(issue.References),
					DataSource:       xrayDataSource,
					CVSSScore:        score,
					CVSSVector:       vector,
				})
			}
		}
	}

	return vulns
}

func isRetriableXrayScanArtifactError(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}

	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}

	normalizedErr := strings.ToLower(err.Error())
	if strings.Contains(normalizedErr, "client.timeout exceeded") || strings.Contains(normalizedErr, "context deadline exceeded") {
		return true
	}

	var httpErr *xrayHTTPError
	if !errors.As(err, &httpErr) {
		return false
	}

	body := strings.ToLower(strings.TrimSpace(httpErr.Body))
	if httpErr.StatusCode == http.StatusInternalServerError && strings.Contains(body, "failed to scan component") {
		return true
	}

	if httpErr.StatusCode == http.StatusConflict {
		return true
	}

	return false
}

func xrayIssueID(issue xraySummaryIssue) string {
	for _, cve := range issue.CVEs {
		if cve.CVE != "" {
			return cve.CVE
		}
	}
	if issue.IssueID != "" {
		return issue.IssueID
	}
	if issue.Summary != "" {
		return issue.Summary
	}
	return "XRAY-UNKNOWN"
}

func xrayPackageName(component xraySummaryComponent) string {
	if component.Name != "" {
		return component.Name
	}
	if component.ComponentID == "" {
		return "unknown"
	}
	componentID := component.ComponentID
	if scheme := strings.Index(componentID, "://"); scheme >= 0 {
		componentID = componentID[scheme+3:]
	}
	componentID = strings.TrimSuffix(componentID, ":"+component.Version)
	if lastSlash := strings.LastIndex(componentID, "/"); lastSlash >= 0 {
		return componentID[lastSlash+1:]
	}
	return componentID
}

func xrayIssueScore(issue xraySummaryIssue) (float64, string) {
	for _, cve := range issue.CVEs {
		if cve.CVSSV3Score > 0 {
			return cve.CVSSV3Score, cve.CVSSV3Vector
		}
		if cve.CVSSScore > 0 {
			return cve.CVSSScore, cve.CVSSVector
		}
	}
	return 0, ""
}

func normalizeXraySeverity(severity string) string {
	switch strings.ToUpper(strings.TrimSpace(severity)) {
	case models.SeverityCritical:
		return models.SeverityCritical
	case models.SeverityHigh:
		return models.SeverityHigh
	case "MEDIUM", "MODERATE":
		return models.SeverityMedium
	case models.SeverityLow:
		return models.SeverityLow
	default:
		return models.SeverityUnknown
	}
}

func xrayReferences(values []any) []string {
	refs := make([]string, 0, len(values))
	seen := make(map[string]bool)
	for _, value := range values {
		switch typed := value.(type) {
		case string:
			trimmed := strings.TrimSpace(typed)
			if trimmed != "" && !seen[trimmed] {
				seen[trimmed] = true
				refs = append(refs, trimmed)
			}
		case map[string]any:
			for _, key := range []string{"url", "reference", "href"} {
				candidate, _ := typed[key].(string)
				candidate = strings.TrimSpace(candidate)
				if candidate != "" && !seen[candidate] {
					seen[candidate] = true
					refs = append(refs, candidate)
					break
				}
			}
		}
	}
	return refs
}
