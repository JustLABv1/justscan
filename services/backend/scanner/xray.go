package scanner

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
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
const xrayMissingArtifactWindow = 2 * time.Minute
const xraySummaryWaitWindow = 15 * time.Minute
const xrayBlockedSummaryWaitWindow = 45 * time.Second
const registryWarmupRetryInterval = 10 * time.Second
const registryWarmupWaitWindow = 10 * time.Minute

type xrayClient struct {
	baseURL       string
	registryURL   string
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
	Errors    []xraySummaryError    `json:"errors"`
}

type xraySummaryError struct {
	Identifier string `json:"identifier"`
	Error      string `json:"error"`
}

type xraySummaryArtifact struct {
	Issues []xraySummaryIssue `json:"issues"`
}

type xraySummaryIssue struct {
	IssueID     string                 `json:"issue_id"`
	Summary     string                 `json:"summary"`
	Description string                 `json:"description"`
	Severity    string                 `json:"severity"`
	CVSS3Max    any                    `json:"cvss3_max_score"`
	CVSS2Max    any                    `json:"cvss2_max_score"`
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
	CVE          string `json:"cve"`
	CVSSV3       any    `json:"cvss_v3"`
	CVSSV2       any    `json:"cvss_v2"`
	CVSSV3Score  any    `json:"cvss_v3_score"`
	CVSSV3Vector string `json:"cvss_v3_vector"`
	CVSSV2Score  any    `json:"cvss_v2_score"`
	CVSSV2Vector string `json:"cvss_v2_vector"`
	CVSSScore    any    `json:"cvss_score"`
	CVSSVector   string `json:"cvss_vector"`
}

type xrayComponentExportRequest struct {
	PackageType       string `json:"package_type"`
	ComponentName     string `json:"component_name"`
	Path              string `json:"path,omitempty"`
	CycloneDX         bool   `json:"cyclonedx,omitempty"`
	CycloneDXFormat   string `json:"cyclonedx_format,omitempty"`
	License           bool   `json:"license,omitempty"`
	LicenseResolution bool   `json:"license_resolution,omitempty"`
	Vulnerabilities   bool   `json:"vulnerabilities,omitempty"`
	Violations        bool   `json:"violations,omitempty"`
	OperationalRisk   bool   `json:"operational_risk,omitempty"`
}

type registryHTTPError struct {
	StatusCode int
	Body       string
}

type registryErrorResponse struct {
	Errors []registryErrorEntry `json:"errors"`
}

type registryErrorEntry struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Detail  map[string]any `json:"detail"`
}

type xrayViolationsRequest struct {
	Filters    *xrayViolationsFilters    `json:"filters,omitempty"`
	Pagination *xrayViolationsPagination `json:"pagination,omitempty"`
}

type xrayViolationsFilters struct {
	IncludeDetails bool                         `json:"include_details,omitempty"`
	Resources      xrayViolationResourceFilters `json:"resources,omitempty"`
}

type xrayViolationResourceFilters struct {
	Artifacts []xrayArtifactResourceFilter `json:"artifacts,omitempty"`
}

type xrayArtifactResourceFilter struct {
	Repository string `json:"repo"`
	Path       string `json:"path"`
}

type xrayViolationsPagination struct {
	Limit     int    `json:"limit,omitempty"`
	Offset    int    `json:"offset,omitempty"`
	OrderBy   string `json:"order_by,omitempty"`
	Direction string `json:"direction,omitempty"`
}

type xrayViolationsResponse struct {
	Total      int                   `json:"total_violations,omitempty"`
	Violations []xrayViolationRecord `json:"violations,omitempty"`
}

type xrayViolationRecord struct {
	ID              string                `json:"violation_id,omitempty"`
	IssueID         string                `json:"issue_id,omitempty"`
	Watch           string                `json:"watch_name,omitempty"`
	Summary         string                `json:"summary,omitempty"`
	Description     string                `json:"description,omitempty"`
	Severity        string                `json:"severity,omitempty"`
	ImpactArtifacts []string              `json:"impact_artifacts,omitempty"`
	Policies        []xrayViolationPolicy `json:"matched_policies,omitempty"`
}

type xrayViolationPolicy struct {
	PolicyName        string `json:"policy,omitempty"`
	Rule              string `json:"rule,omitempty"`
	FailBuild         bool   `json:"is_build_failed,omitempty"`
	FailPullRequest   bool   `json:"fail_pull_request,omitempty"`
	SkipNotApplicable bool   `json:"is_skip_not_applicable,omitempty"`
	IsBlocking        bool   `json:"is_blocking,omitempty"`
}

type xrayViolationLookupTarget struct {
	Repository string
	Path       string
}

func (e *registryHTTPError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("registry API returned HTTP %d", e.StatusCode)
	}
	return fmt.Sprintf("registry API returned HTTP %d: %s", e.StatusCode, e.Body)
}

type registryManifest struct {
	MediaType string                       `json:"mediaType"`
	Config    registryManifestDescriptor   `json:"config"`
	Layers    []registryManifestDescriptor `json:"layers"`
	Manifests []registryManifestDescriptor `json:"manifests"`
}

type registryManifestDescriptor struct {
	MediaType string                    `json:"mediaType"`
	Digest    string                    `json:"digest"`
	Platform  *registryManifestPlatform `json:"platform"`
}

type registryManifestPlatform struct {
	OS           string `json:"os"`
	Architecture string `json:"architecture"`
	Variant      string `json:"variant"`
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

	repoKey, artifactName, imageTag, err := xrayImageParts(scan.ImageName, scan.ImageTag, registry)
	if err != nil {
		return err
	}

	imageRepoPath := repoKey + "/" + artifactName
	artifactRepoPath := artifactName + "/" + imageTag + "/manifest.json"
	repoPath := imageRepoPath + "/" + imageTag + "/manifest.json"
	artifactPath := client.artifactoryID + "/" + repoPath
	if imageConfig, configErr := client.imageConfigMetadata(ctx, imageRepoPath, imageTag, scan.Platform); configErr != nil {
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Unable to load image config metadata from Artifactory: %v", configErr))
	} else if len(imageConfig) > 0 {
		scan.ImageConfig = imageConfig
		architecture, osFamily, osName := xrayImageMetadataFields(imageConfig)
		if architecture != "" {
			scan.Architecture = architecture
		}
		if osFamily != "" {
			scan.OSFamily = osFamily
		}
		if osName != "" {
			scan.OSName = osName
		}
		if _, err := db.NewUpdate().Model(scan).
			Column("image_config", "architecture", "os_family", "os_name").
			Where("id = ?", scan.ID).
			Exec(ctx); err != nil {
			return fmt.Errorf("failed to persist xray image metadata: %w", err)
		}
		recordScanStepOutput(ctx, db, scan.ID, "Loaded image config metadata from Artifactory for richer scan details.")
	}
	if resolvedDigest, resolveErr := client.resolveImageDigest(ctx, imageRepoPath, imageTag, scan.Platform); resolveErr != nil {
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Unable to resolve image digest before starting the Xray flow: %v", resolveErr))
	} else if resolvedDigest != "" {
		scan.ImageDigest = resolvedDigest
		if _, err := db.NewUpdate().Model(scan).
			Column("image_digest").
			Where("id = ?", scan.ID).
			Exec(ctx); err != nil {
			return fmt.Errorf("failed to persist xray image digest: %w", err)
		}
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Resolved image digest %s for suppression and reporting.", resolvedDigest))
	}

	componentID := "docker://" + buildImageRef(scan.ImageName, scan.ImageTag)
	if err := updateXrayMetadata(ctx, db, scan.ID, componentID, "warming_artifactory_cache", models.ScanStepWarmingCache); err != nil {
		return err
	}
	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Resolved Artifactory artifact path %s.", artifactPath))
	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Using Xray component identifier %s.", componentID))
	scan.ExternalScanID = componentID
	scan.ExternalStatus = "warming_artifactory_cache"
	scan.CurrentStep = models.ScanStepWarmingCache

	if err := client.warmImageInArtifactory(ctx, imageRepoPath, imageTag, scan.Platform); err != nil {
		if normalizedMessage, ok := normalizeXrayDownloadBlockedError(err); ok {
			targets := blockedViolationLookupTargets(err, repoKey, artifactRepoPath)
			violations, violationsErr := client.getViolations(ctx, targets)
			if violationsErr != nil {
				log.Warnf("Failed to fetch Xray violations for blocked scan %s: %v", scan.ID, violationsErr)
			} else if enrichment := formatBlockedViolationsSummary(violations); enrichment != "" {
				normalizedMessage += "\n" + enrichment
			}
			recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Artifactory reported a blocking policy while warming %s.", artifactPath))
			if err := updateXrayMetadata(ctx, db, scan.ID, componentID, models.ScanExternalStatusBlockedByXrayPolicy, models.ScanStepFailed); err != nil {
				return err
			}
			scan.ExternalStatus = models.ScanExternalStatusBlockedByXrayPolicy
			scan.CurrentStep = models.ScanStepFailed

			client.bestEffortTriggerBlockedArtifactScan(ctx, componentID, targets)
			recordScanStepOutput(ctx, db, scan.ID, "Triggered best-effort blocked-artifact indexing so any available findings can still be imported.")

			if summary, blockedArtifactPath, summaryErr := client.bestEffortBlockedArtifactSummary(ctx, targets); summaryErr != nil {
				log.Warnf("Failed to fetch Xray artifact summary for blocked scan %s: %v", scan.ID, summaryErr)
			} else if summary != nil {
				recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Fetched a blocked-artifact summary from %s.", blockedArtifactPath))
				if err := persistXraySummaryFindings(ctx, db, scan, summary); err != nil {
					log.Warnf("Failed to persist Xray findings for blocked scan %s: %v", scan.ID, err)
				} else {
					log.Infof("Imported Xray vulnerabilities for blocked scan %s from %s", scan.ID, blockedArtifactPath)
				}
			}

			if scan.CriticalCount+scan.HighCount+scan.MediumCount+scan.LowCount+scan.UnknownCount == 0 {
				if recoveredCount, exportErr := persistXrayCycloneDXFallback(ctx, db, scan, client, artifactPath, repoPath); exportErr != nil {
					log.Warnf("Failed to persist Xray CycloneDX fallback findings for blocked scan %s: %v", scan.ID, exportErr)
				} else if recoveredCount > 0 {
					recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Recovered %d vulnerabilities from the Xray CycloneDX export.", recoveredCount))
				}
			}

			if scan.CriticalCount+scan.HighCount+scan.MediumCount+scan.LowCount+scan.UnknownCount == 0 && violations != nil && len(violations.Violations) > 0 {
				if err := persistXrayViolationFindings(ctx, db, scan, violations); err != nil {
					log.Warnf("Failed to persist Xray violation fallback findings for blocked scan %s: %v", scan.ID, err)
				} else {
					recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Recovered %d fallback findings from Xray policy violations.", len(violations.Violations)))
				}
			}

			if scan.CriticalCount+scan.HighCount+scan.MediumCount+scan.LowCount+scan.UnknownCount > 0 {
				// CycloneDX fallback already persisted SBOM data when it succeeded.
			} else if err := persistXraySBOMComponents(ctx, db, scan, client, artifactPath, repoPath); err != nil {
				log.Warnf("Failed to persist Xray SBOM components for blocked scan %s: %v", scan.ID, err)
			}

			return errors.New(normalizedMessage)
		}
		return fmt.Errorf("failed to warm image into artifactory cache: %w", err)
	}
	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Artifactory cache warm-up completed for %s.", artifactPath))

	if err := updateXrayMetadata(ctx, db, scan.ID, componentID, "indexing", models.ScanStepIndexingArtifact); err != nil {
		return err
	}
	scan.ExternalStatus = "indexing"
	scan.CurrentStep = models.ScanStepIndexingArtifact
	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Requested Xray indexing for %s.", repoPath))

	if err := client.scanNow(ctx, repoPath); err != nil {
		// Scan Artifact can still succeed for already-indexed images.
		// Keep going so Xray-backed scans remain usable across setups.
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Xray index request returned a non-fatal response for %s: %v", repoPath, err))
	}

	if err := updateXrayMetadata(ctx, db, scan.ID, componentID, "queued", models.ScanStepQueuedInXray); err != nil {
		return err
	}
	scan.ExternalStatus = "queued"
	scan.CurrentStep = models.ScanStepQueuedInXray
	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Submitted the artifact scan request for component %s.", componentID))

	if err := client.scanArtifact(ctx, componentID); err != nil {
		if !isRetriableXrayScanArtifactError(err) {
			return err
		}
		log.Warnf("Xray scanArtifact returned a non-fatal error for scan %s (%s); continuing to poll artifact summary: %v", scan.ID, componentID, err)
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Xray scanArtifact returned a non-fatal response; continuing to poll the artifact summary anyway: %v", err))
	}

	if err := updateXrayMetadata(ctx, db, scan.ID, componentID, "waiting_for_xray", models.ScanStepWaitingForXray); err != nil {
		return err
	}
	scan.ExternalStatus = "waiting_for_xray"
	scan.CurrentStep = models.ScanStepWaitingForXray
	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Polling Xray for the artifact summary at %s.", artifactPath))

	summary, err := client.pollArtifactSummary(ctx, artifactPath)
	if err != nil {
		return err
	}

	if err := updateXrayMetadata(ctx, db, scan.ID, componentID, "importing", models.ScanStepImportingResults); err != nil {
		return err
	}
	scan.ExternalStatus = "importing"
	scan.CurrentStep = models.ScanStepImportingResults
	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Xray returned %d artifact summaries. Importing findings now.", len(summary.Artifacts)))

	if err := persistXraySummaryFindings(ctx, db, scan, summary); err != nil {
		return err
	}
	if err := persistXraySBOMComponents(ctx, db, scan, client, artifactPath, repoPath); err != nil {
		log.Warnf("Failed to persist Xray SBOM components for scan %s (non-fatal): %v", scan.ID, err)
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Xray SBOM import did not complete: %v", err))
	}

	completedAt := time.Now()
	scan.Status = models.ScanStatusCompleted
	scan.CompletedAt = &completedAt
	scan.ExternalStatus = "completed"
	scan.CurrentStep = models.ScanStepCompleted

	if _, err := db.NewUpdate().Model(scan).
		Column("status", "completed_at", "critical_count", "high_count", "medium_count", "low_count", "unknown_count", "external_scan_id", "external_status", "image_config", "architecture", "os_family", "os_name").
		Where("id = ?", scan.ID).
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to mark xray scan as completed: %w", err)
	}
	if err := setScanStep(ctx, db, scan, models.ScanStepCompleted); err != nil {
		return err
	}
	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Xray scan completed with %d total findings.", scan.CriticalCount+scan.HighCount+scan.MediumCount+scan.LowCount+scan.UnknownCount))

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

func EnsureScanImageDigest(ctx context.Context, db *bun.DB, scan *models.Scan) (string, error) {
	if scan == nil {
		return "", fmt.Errorf("scan is required")
	}

	if digest := strings.TrimSpace(scan.ImageDigest); digest != "" {
		return digest, nil
	}

	if scan.ScanProvider != models.ScanProviderArtifactoryXray {
		return "", nil
	}

	if scan.RegistryID == nil {
		return "", fmt.Errorf("xray scan %s is missing a registry selection", scan.ID)
	}

	registry := &models.Registry{}
	if err := db.NewSelect().Model(registry).Where("id = ?", *scan.RegistryID).Scan(ctx); err != nil {
		return "", fmt.Errorf("failed to load registry for xray digest resolution: %w", err)
	}

	client, err := newXrayClient(registry)
	if err != nil {
		return "", err
	}

	repoKey, artifactName, imageTag, err := xrayImageParts(scan.ImageName, scan.ImageTag, registry)
	if err != nil {
		return "", err
	}

	resolvedDigest, err := client.resolveImageDigest(ctx, repoKey+"/"+artifactName, imageTag, scan.Platform)
	if err != nil {
		return "", err
	}
	if resolvedDigest == "" {
		return "", nil
	}

	scan.ImageDigest = resolvedDigest
	if _, err := db.NewUpdate().Model(scan).
		Column("image_digest").
		Where("id = ?", scan.ID).
		Exec(ctx); err != nil {
		return "", fmt.Errorf("failed to persist image digest for scan %s: %w", scan.ID, err)
	}

	return resolvedDigest, nil
}

func (c *xrayClient) resolveImageDigest(ctx context.Context, imageRepoPath, reference, platform string) (string, error) {
	if strings.TrimSpace(reference) == "" {
		return "", fmt.Errorf("missing manifest reference for %s", imageRepoPath)
	}
	_, digest, err := c.resolveImageManifest(ctx, imageRepoPath, reference, platform)
	if err != nil {
		return "", err
	}
	return digest, nil
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
		registryURL:   strings.TrimRight(strings.TrimSpace(registry.URL), "/"),
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

func (c *xrayClient) exportComponentCycloneDX(ctx context.Context, componentName string, candidatePaths ...string) (*TrivySBOMOutput, string, error) {
	trimmedPaths := make([]string, 0, len(candidatePaths)+1)
	seen := make(map[string]bool)
	for _, candidate := range append(candidatePaths, "") {
		path := strings.TrimSpace(candidate)
		if seen[path] {
			continue
		}
		seen[path] = true
		trimmedPaths = append(trimmedPaths, path)
	}

	var lastErr error
	for _, candidatePath := range trimmedPaths {
		body := xrayComponentExportRequest{
			PackageType:       "docker",
			ComponentName:     componentName,
			Path:              candidatePath,
			CycloneDX:         true,
			CycloneDXFormat:   "json",
			License:           true,
			LicenseResolution: true,
			Vulnerabilities:   true,
			Violations:        true,
			OperationalRisk:   true,
		}

		payload, err := c.doRawJSON(ctx, http.MethodPost, "/xray/api/v2/component/exportDetails", body, "application/zip", http.StatusOK)
		if err != nil {
			lastErr = err
			continue
		}

		sbom, err := parseXrayCycloneDXExport(payload)
		if err != nil {
			lastErr = err
			continue
		}
		return sbom, candidatePath, nil
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("xray component export did not return a CycloneDX SBOM")
	}
	return nil, "", lastErr
}

func (c *xrayClient) warmImageInArtifactory(ctx context.Context, imageRepoPath, tag, platform string) error {
	deadline := time.Now().Add(registryWarmupWaitWindow)
	var lastErr error

	for {
		seenManifests := make(map[string]bool)
		seenBlobs := make(map[string]bool)
		err := c.warmManifestReference(ctx, imageRepoPath, tag, platform, seenManifests, seenBlobs)
		if err == nil {
			return nil
		}
		if !isRetriableRegistryWarmupError(err) {
			return err
		}

		lastErr = err
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out after %s warming the artifactory cache: %w", registryWarmupWaitWindow, lastErr)
		}

		log.Warnf("Artifactory cache warm-up for %s:%s hit a transient error; retrying in %s: %v", imageRepoPath, tag, registryWarmupRetryInterval, err)

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(registryWarmupRetryInterval):
		}
	}
}

func (c *xrayClient) warmManifestReference(ctx context.Context, imageRepoPath, reference, platform string, seenManifests, seenBlobs map[string]bool) error {
	if reference == "" {
		return fmt.Errorf("missing manifest reference for %s", imageRepoPath)
	}
	if seenManifests[reference] {
		return nil
	}
	seenManifests[reference] = true

	manifest, mediaType, _, err := c.fetchRegistryManifest(ctx, imageRepoPath, reference)
	if err != nil {
		return err
	}

	if isRegistryManifestIndex(mediaType, manifest) {
		targets := selectManifestDescriptors(manifest.Manifests, platform)
		if len(targets) == 0 {
			return fmt.Errorf("registry manifest list for %s did not contain a usable image manifest", reference)
		}
		for _, target := range targets {
			if target.Digest == "" {
				continue
			}
			if err := c.warmManifestReference(ctx, imageRepoPath, target.Digest, "", seenManifests, seenBlobs); err != nil {
				return err
			}
		}
		return nil
	}

	if err := c.warmBlob(ctx, imageRepoPath, manifest.Config.Digest, seenBlobs); err != nil {
		return err
	}
	for _, layer := range manifest.Layers {
		if err := c.warmBlob(ctx, imageRepoPath, layer.Digest, seenBlobs); err != nil {
			return err
		}
	}

	return nil
}

func (c *xrayClient) fetchRegistryManifest(ctx context.Context, imageRepoPath, reference string) (*registryManifest, string, string, error) {
	response, err := c.doRegistryRequest(ctx, http.MethodGet, registryManifestPath(imageRepoPath, reference), []string{
		"application/vnd.oci.image.index.v1+json",
		"application/vnd.docker.distribution.manifest.list.v2+json",
		"application/vnd.oci.image.manifest.v1+json",
		"application/vnd.docker.distribution.manifest.v2+json",
	})
	if err != nil {
		return nil, "", "", err
	}
	defer response.Body.Close()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to read registry manifest response: %w", err)
	}

	var manifest registryManifest
	if err := json.Unmarshal(body, &manifest); err != nil {
		return nil, "", "", fmt.Errorf("failed to decode registry manifest: %w", err)
	}

	contentType := normalizeRegistryContentType(response.Header.Get("Content-Type"))
	if manifest.MediaType == "" {
		manifest.MediaType = contentType
	}

	return &manifest, manifest.MediaType, strings.TrimSpace(response.Header.Get("Docker-Content-Digest")), nil
}

func (c *xrayClient) resolveImageManifest(ctx context.Context, imageRepoPath, reference, platform string) (*registryManifest, string, error) {
	manifest, mediaType, contentDigest, err := c.fetchRegistryManifest(ctx, imageRepoPath, reference)
	if err != nil {
		return nil, "", err
	}

	if isRegistryManifestIndex(mediaType, manifest) {
		targets := selectManifestDescriptors(manifest.Manifests, platform)
		if len(targets) == 0 {
			return nil, "", fmt.Errorf("registry manifest list for %s did not contain a usable image manifest", reference)
		}
		for _, target := range targets {
			if digest := strings.TrimSpace(target.Digest); digest != "" {
				return c.resolveImageManifest(ctx, imageRepoPath, digest, "")
			}
		}
		return nil, "", fmt.Errorf("registry manifest list for %s did not expose a child digest", reference)
	}

	if digest := strings.TrimSpace(contentDigest); digest != "" {
		return manifest, digest, nil
	}
	if strings.HasPrefix(reference, "sha256:") {
		return manifest, reference, nil
	}

	return nil, "", fmt.Errorf("registry manifest for %s did not expose a Docker-Content-Digest header", reference)
}

func (c *xrayClient) fetchRegistryBlob(ctx context.Context, imageRepoPath, digest string) ([]byte, error) {
	response, err := c.doRegistryRequest(ctx, http.MethodGet, registryBlobPath(imageRepoPath, digest), nil)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read registry blob %s: %w", digest, err)
	}
	return body, nil
}

func (c *xrayClient) imageConfigMetadata(ctx context.Context, imageRepoPath, reference, platform string) (models.JSONObject, error) {
	manifest, _, err := c.resolveImageManifest(ctx, imageRepoPath, reference, platform)
	if err != nil {
		return nil, err
	}
	if manifest == nil || strings.TrimSpace(manifest.Config.Digest) == "" {
		return nil, fmt.Errorf("registry manifest did not expose an image config digest")
	}

	body, err := c.fetchRegistryBlob(ctx, imageRepoPath, strings.TrimSpace(manifest.Config.Digest))
	if err != nil {
		return nil, err
	}

	var payload models.JSONObject
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("failed to decode image config metadata: %w", err)
	}
	return payload, nil
}

func (c *xrayClient) warmBlob(ctx context.Context, imageRepoPath, digest string, seenBlobs map[string]bool) error {
	if digest == "" || seenBlobs[digest] {
		return nil
	}
	seenBlobs[digest] = true

	response, err := c.doRegistryRequest(ctx, http.MethodGet, registryBlobPath(imageRepoPath, digest), nil)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if _, err := io.Copy(io.Discard, response.Body); err != nil {
		return fmt.Errorf("failed to read registry blob %s: %w", digest, err)
	}

	return nil
}

func (c *xrayClient) pollArtifactSummary(ctx context.Context, artifactPath string) (*xraySummaryResponse, error) {
	return c.pollArtifactSummaryWithin(ctx, artifactPath, xraySummaryWaitWindow)
}

func (c *xrayClient) pollArtifactSummaryWithin(ctx context.Context, artifactPath string, waitWindow time.Duration) (*xraySummaryResponse, error) {
	deadline := time.Now().Add(waitWindow)
	var missingArtifactSince time.Time
	for {
		summary, err := c.artifactSummary(ctx, artifactPath)
		if err == nil {
			if hasMissingXraySummaryError(summary) {
				if missingArtifactSince.IsZero() {
					missingArtifactSince = time.Now()
				}
				if time.Since(missingArtifactSince) >= xrayMissingArtifactWindow {
					return nil, fmt.Errorf("xray did not expose artifact summary for %s within %s; the image may not exist in Artifactory/Xray yet (%s)", artifactPath, xrayMissingArtifactWindow, formatXraySummaryErrors(summary.Errors))
				}
			} else {
				missingArtifactSince = time.Time{}
			}
			if len(summary.Artifacts) > 0 {
				return summary, nil
			}
		} else {
			var httpErr *xrayHTTPError
			if !errors.As(err, &httpErr) || (httpErr.StatusCode != http.StatusNotFound && httpErr.StatusCode != http.StatusBadRequest) {
				return nil, err
			}

			if missingArtifactSince.IsZero() {
				missingArtifactSince = time.Now()
			}
			if time.Since(missingArtifactSince) >= xrayMissingArtifactWindow {
				detail := strings.TrimSpace(httpErr.Body)
				if detail == "" {
					detail = fmt.Sprintf("HTTP %d", httpErr.StatusCode)
				}
				return nil, fmt.Errorf("xray did not expose artifact summary for %s within %s; the image may not exist in Artifactory/Xray yet (%s)", artifactPath, xrayMissingArtifactWindow, detail)
			}
		}

		if time.Now().After(deadline) {
			return nil, fmt.Errorf("timed out after %s waiting for xray results for %s", waitWindow, artifactPath)
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(xraySummaryPollInterval):
		}
	}
}

func (c *xrayClient) bestEffortBlockedArtifactSummary(ctx context.Context, targets []xrayViolationLookupTarget) (*xraySummaryResponse, string, error) {
	artifactPaths := blockedArtifactSummaryPaths(c.artifactoryID, targets)
	if len(artifactPaths) == 0 {
		return nil, "", nil
	}

	deadline := time.Now().Add(xrayBlockedSummaryWaitWindow)
	for {
		for _, artifactPath := range artifactPaths {
			summary, err := c.artifactSummary(ctx, artifactPath)
			if err == nil {
				if hasMissingXraySummaryError(summary) || len(summary.Artifacts) == 0 {
					continue
				}
				return summary, artifactPath, nil
			}

			var httpErr *xrayHTTPError
			if errors.As(err, &httpErr) && (httpErr.StatusCode == http.StatusNotFound || httpErr.StatusCode == http.StatusBadRequest) {
				continue
			}

			return nil, "", err
		}

		if time.Now().After(deadline) {
			return nil, "", nil
		}

		select {
		case <-ctx.Done():
			return nil, "", ctx.Err()
		case <-time.After(xraySummaryPollInterval):
		}
	}
}

func (c *xrayClient) bestEffortTriggerBlockedArtifactScan(ctx context.Context, componentID string, targets []xrayViolationLookupTarget) {
	for _, target := range targets {
		repository := strings.TrimSpace(target.Repository)
		path := strings.TrimSpace(target.Path)
		if repository == "" || path == "" {
			continue
		}

		repoPath := repository + "/" + path
		if err := c.scanNow(ctx, repoPath); err != nil {
			if shouldWarnBlockedReindexError(err) {
				log.Warnf("Failed to trigger Xray re-index for blocked artifact %s: %v", repoPath, err)
			} else {
				log.Debugf("Skipping blocked-artifact re-index warning for %s: %v", repoPath, err)
			}
		}
	}

	if componentID == "" {
		return
	}
	if err := c.scanArtifact(ctx, componentID); err != nil && !isRetriableXrayScanArtifactError(err) {
		log.Warnf("Failed to trigger Xray scanArtifact for blocked component %s: %v", componentID, err)
	}
}

func (c *xrayClient) doJSON(ctx context.Context, method, path string, body any, out any, allowedStatus ...int) ([]byte, error) {
	payload, err := c.doRawJSON(ctx, method, path, body, "application/json", allowedStatus...)
	if err != nil {
		return nil, err
	}
	if out != nil && len(payload) > 0 {
		if err := json.Unmarshal(payload, out); err != nil {
			return nil, fmt.Errorf("failed to decode xray response: %w", err)
		}
	}
	return payload, nil
}

func (c *xrayClient) doRawJSON(ctx context.Context, method, path string, body any, accept string, allowedStatus ...int) ([]byte, error) {
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
	if strings.TrimSpace(accept) == "" {
		accept = "application/json"
	}
	req.Header.Set("Accept", accept)
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
			return responseBody, nil
		}
	}

	return nil, &xrayHTTPError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(responseBody))}
}

func (c *xrayClient) doRegistryRequest(ctx context.Context, method, path string, accept []string) (*http.Response, error) {
	if c.registryURL == "" {
		return nil, fmt.Errorf("registry URL is not configured")
	}

	req, err := http.NewRequestWithContext(ctx, method, c.registryURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to build registry request: %w", err)
	}
	if len(accept) > 0 {
		req.Header.Set("Accept", strings.Join(accept, ", "))
	}
	applyXrayAuth(req, c.authType, c.username, c.secret)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("registry request failed: %w", err)
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return resp, nil
	}

	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4096))
	resp.Body.Close()
	if readErr != nil {
		return nil, fmt.Errorf("failed to read registry error response: %w", readErr)
	}

	return nil, &registryHTTPError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(body))}
}

func (c *xrayClient) getViolations(ctx context.Context, targets []xrayViolationLookupTarget) (*xrayViolationsResponse, error) {
	artifactFilters := make([]xrayArtifactResourceFilter, 0, len(targets))
	for _, target := range targets {
		if strings.TrimSpace(target.Repository) == "" || strings.TrimSpace(target.Path) == "" {
			continue
		}
		artifactFilters = append(artifactFilters, xrayArtifactResourceFilter{
			Repository: strings.TrimSpace(target.Repository),
			Path:       strings.TrimSpace(target.Path),
		})
	}
	if len(artifactFilters) == 0 {
		return nil, fmt.Errorf("missing xray violations lookup target")
	}

	request := xrayViolationsRequest{
		Filters: &xrayViolationsFilters{
			IncludeDetails: true,
			Resources: xrayViolationResourceFilters{
				Artifacts: artifactFilters,
			},
		},
		Pagination: &xrayViolationsPagination{
			Limit:     20,
			Offset:    0,
			OrderBy:   "created",
			Direction: "desc",
		},
	}

	var response xrayViolationsResponse
	if _, err := c.doJSON(ctx, http.MethodPost, "/xray/api/v1/violations", request, &response, http.StatusOK); err != nil {
		return nil, err
	}
	return &response, nil
}

func (c *xrayClient) contextualAnalysis(ctx context.Context, vulnerabilityID, componentID, sourceComponentID, artifactPath string) (models.JSONObject, error) {
	params := url.Values{}
	params.Set("vulnerability_id", vulnerabilityID)
	params.Set("component_id", componentID)
	if strings.TrimSpace(sourceComponentID) != "" {
		params.Set("source_comp_id", sourceComponentID)
	}
	if strings.TrimSpace(artifactPath) != "" {
		params.Set("path", artifactPath)
	}

	endpoint := "/xray/api/v2/cve_applicability?" + params.Encode()
	var response models.JSONObject
	if _, err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response, http.StatusOK); err != nil {
		return nil, err
	}
	return response, nil
}

func (c *xrayClient) enrichBlockedScanMessage(ctx context.Context, targets []xrayViolationLookupTarget, baseMessage string) string {
	if len(targets) == 0 {
		return baseMessage
	}

	violations, err := c.getViolations(ctx, targets)
	if err != nil {
		log.Warnf("Failed to enrich blocked Xray scan with violations data for targets %+v: %v", targets, err)
		return baseMessage
	}

	enrichment := formatBlockedViolationsSummary(violations)
	if enrichment == "" {
		return baseMessage
	}
	return baseMessage + "\n" + enrichment
}

func blockedViolationLookupTargets(err error, fallbackRepository, fallbackArtifactPath string) []xrayViolationLookupTarget {
	targets := make([]xrayViolationLookupTarget, 0, 4)
	seen := make(map[string]bool)
	addTarget := func(repository, path string) {
		repository = strings.TrimSpace(repository)
		path = strings.TrimSpace(path)
		if repository == "" || path == "" {
			return
		}
		key := repository + "\x00" + path
		if seen[key] {
			return
		}
		seen[key] = true
		targets = append(targets, xrayViolationLookupTarget{Repository: repository, Path: path})
	}

	var httpErr *registryHTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != http.StatusForbidden {
		addTarget(fallbackRepository, fallbackArtifactPath)
		return targets
	}

	body := strings.TrimSpace(httpErr.Body)
	if body == "" {
		addTarget(fallbackRepository, fallbackArtifactPath)
		return targets
	}

	var response registryErrorResponse
	if json.Unmarshal([]byte(body), &response) != nil {
		addTarget(fallbackRepository, fallbackArtifactPath)
		return targets
	}

	for _, entry := range response.Errors {
		if !isXrayDownloadBlockedEntry(entry) {
			continue
		}

		repository := firstNonEmpty(
			stringDetail(entry.Detail, "repository"),
			stringDetail(entry.Detail, "repo"),
			stringDetail(entry.Detail, "remote_repository"),
			stringDetail(entry.Detail, "remote_repo"),
			blockedRepository(entry.Message),
			fallbackRepository,
		)

		addTarget(repository, blockedArtifactPath(entry.Message))
		addTarget(repository, stringDetail(entry.Detail, "artifact_path"))
		addTarget(repository, stringDetail(entry.Detail, "path"))
		addTarget(repository, stringDetail(entry.Detail, "artifact"))
		addTarget(repository, stringDetail(entry.Detail, "manifest_path"))
	}

	addTarget(fallbackRepository, fallbackArtifactPath)

	return targets
}

func blockedArtifactSummaryPaths(artifactoryID string, targets []xrayViolationLookupTarget) []string {
	paths := make([]string, 0, len(targets))
	seen := make(map[string]bool)
	for _, target := range targets {
		repository := strings.TrimSpace(target.Repository)
		path := strings.TrimSpace(target.Path)
		if repository == "" || path == "" {
			continue
		}
		artifactPath := strings.TrimSpace(artifactoryID)
		if artifactPath != "" {
			artifactPath += "/"
		}
		artifactPath += repository + "/" + path
		if seen[artifactPath] {
			continue
		}
		seen[artifactPath] = true
		paths = append(paths, artifactPath)
	}
	return paths
}

func normalizeXrayDownloadBlockedError(err error) (string, bool) {
	var httpErr *registryHTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != http.StatusForbidden {
		return "", false
	}

	body := strings.TrimSpace(httpErr.Body)
	if body == "" {
		return "", false
	}

	var response registryErrorResponse
	if json.Unmarshal([]byte(body), &response) == nil {
		for _, entry := range response.Errors {
			if !isXrayDownloadBlockedEntry(entry) {
				continue
			}
			return formatXrayDownloadBlockedMessage(entry), true
		}
	}

	if strings.Contains(strings.ToLower(body), "download blocking policy configured in xray") {
		return "Xray blocked Artifactory from downloading this image because a download blocking policy rejected it.", true
	}

	return "", false
}

func isXrayDownloadBlockedEntry(entry registryErrorEntry) bool {
	if strings.EqualFold(strings.TrimSpace(entry.Code), "DENIED") {
		return true
	}
	return strings.Contains(strings.ToLower(strings.TrimSpace(entry.Message)), "download blocking policy configured in xray")
}

func formatXrayDownloadBlockedMessage(entry registryErrorEntry) string {
	lines := []string{
		"Xray blocked Artifactory from downloading this image because a download blocking policy rejected it.",
	}

	if manifest := strings.TrimSpace(stringDetail(entry.Detail, "manifest")); manifest != "" {
		lines = append(lines, "Manifest: "+manifest)
	}

	if artifactPath := blockedArtifactPath(entry.Message); artifactPath != "" {
		lines = append(lines, "Artifact: "+artifactPath)
	}

	for _, key := range []string{"policy", "policy_name", "watch", "watch_name", "repository", "repo", "remote_repository", "remote_repo"} {
		if value := strings.TrimSpace(stringDetail(entry.Detail, key)); value != "" {
			lines = append(lines, formatDetailLabel(key)+": "+value)
		}
	}

	if jfrogMessage := strings.TrimSpace(entry.Message); jfrogMessage != "" {
		lines = append(lines, "JFrog: "+jfrogMessage)
	}

	return strings.Join(lines, "\n")
}

func formatBlockedViolationsSummary(response *xrayViolationsResponse) string {
	if response == nil || len(response.Violations) == 0 {
		return ""
	}

	issues := make([]string, 0)
	seenIssues := make(map[string]bool)
	watches := make([]string, 0)
	seenWatches := make(map[string]bool)
	policies := make([]string, 0)
	seenPolicies := make(map[string]bool)
	blockingPolicies := make([]string, 0)
	seenBlockingPolicies := make(map[string]bool)

	for _, violation := range response.Violations {
		issueLabel := strings.TrimSpace(violation.IssueID)
		if severity := strings.TrimSpace(violation.Severity); severity != "" {
			if issueLabel != "" {
				issueLabel += " (" + severity + ")"
			} else {
				issueLabel = severity
			}
		}
		if issueLabel != "" && !seenIssues[issueLabel] {
			seenIssues[issueLabel] = true
			issues = append(issues, issueLabel)
		}
		if watch := strings.TrimSpace(violation.Watch); watch != "" && !seenWatches[watch] {
			seenWatches[watch] = true
			watches = append(watches, watch)
		}
		for _, policy := range violation.Policies {
			policyLabel := strings.TrimSpace(policy.PolicyName)
			if rule := strings.TrimSpace(policy.Rule); rule != "" {
				if policyLabel != "" {
					policyLabel += " [rule: " + rule + "]"
				} else {
					policyLabel = "rule: " + rule
				}
			}
			if policyLabel != "" && !seenPolicies[policyLabel] {
				seenPolicies[policyLabel] = true
				policies = append(policies, policyLabel)
			}

			blockingLabel := strings.TrimSpace(policy.PolicyName)
			if policy.IsBlocking {
				if blockingLabel == "" {
					blockingLabel = policyLabel
				}
				if blockingLabel != "" && !seenBlockingPolicies[blockingLabel] {
					seenBlockingPolicies[blockingLabel] = true
					blockingPolicies = append(blockingPolicies, blockingLabel)
				}
			}
		}
	}

	lines := make([]string, 0, 3)
	if len(issues) > 0 {
		lines = append(lines, "Matched issues: "+joinWithOverflow(issues, 8))
	}
	if len(watches) > 0 {
		lines = append(lines, "Matched watches: "+strings.Join(watches, ", "))
	}
	if len(blockingPolicies) > 0 {
		lines = append(lines, "Blocking policies: "+strings.Join(blockingPolicies, ", "))
	} else if len(policies) > 0 {
		lines = append(lines, "Matched policies: "+strings.Join(policies, ", "))
	}
	if response.Total > 0 {
		lines = append(lines, fmt.Sprintf("Xray violations found for this artifact: %d", response.Total))
	}

	return strings.Join(lines, "\n")
}

func joinWithOverflow(values []string, limit int) string {
	if len(values) == 0 {
		return ""
	}
	if limit <= 0 || len(values) <= limit {
		return strings.Join(values, ", ")
	}
	return strings.Join(values[:limit], ", ") + fmt.Sprintf(" (+%d more)", len(values)-limit)
}

func stringDetail(detail map[string]any, key string) string {
	if detail == nil {
		return ""
	}
	value, ok := detail[key]
	if !ok || value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

func blockedArtifactPath(message string) string {
	message = strings.TrimSpace(message)
	if message == "" {
		return ""
	}

	const prefix = "Artifact download request rejected:"
	idx := strings.Index(message, prefix)
	if idx == -1 {
		return ""
	}
	artifact := strings.TrimSpace(message[idx+len(prefix):])
	artifact = strings.TrimSuffix(artifact, ".")
	if cut := strings.Index(strings.ToLower(artifact), " was not downloaded"); cut >= 0 {
		artifact = strings.TrimSpace(artifact[:cut])
	}
	return artifact
}

func blockedRepository(message string) string {
	message = strings.TrimSpace(message)
	if message == "" {
		return ""
	}

	const marker = "configured in Xray for "
	idx := strings.LastIndex(message, marker)
	if idx == -1 {
		return ""
	}

	repository := strings.TrimSpace(message[idx+len(marker):])
	repository = strings.TrimSuffix(repository, ".")
	return repository
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func formatDetailLabel(key string) string {
	label := strings.ReplaceAll(strings.TrimSpace(key), "_", " ")
	if label == "" {
		return "Detail"
	}
	return strings.ToUpper(label[:1]) + label[1:]
}

func applyXrayAuth(req *http.Request, authType, username, secret string) {
	switch authType {
	case models.RegistryAuthBasic:
		req.SetBasicAuth(username, secret)
	case models.RegistryAuthToken:
		req.Header.Set("Authorization", "Bearer "+secret)
	}
}

func xrayImageParts(imageName, imageTag string, registry *models.Registry) (string, string, string, error) {
	imagePath := strings.TrimSpace(imageName)
	registryHost := normalizeRegistryHost(registry.URL)
	if registryHost != "" && strings.HasPrefix(imagePath, registryHost+"/") {
		imagePath = strings.TrimPrefix(imagePath, registryHost+"/")
	}
	imagePath = strings.TrimPrefix(imagePath, "/")

	parts := strings.Split(imagePath, "/")
	if len(parts) < 2 {
		return "", "", "", fmt.Errorf("image %q must include an Artifactory repository key when using Xray", imageName)
	}

	repo := parts[0]
	artifactName := strings.Join(parts[1:], "/")
	tag := strings.TrimPrefix(strings.TrimSpace(imageTag), ":")
	if tag == "" {
		return "", "", "", fmt.Errorf("image tag is required for xray scans")
	}

	return repo, artifactName, tag, nil
}

func xrayArtifactPaths(imageName, imageTag string, registry *models.Registry, artifactoryID string) (string, string, error) {
	repo, artifactName, tag, err := xrayImageParts(imageName, imageTag, registry)
	if err != nil {
		return "", "", err
	}

	repoPath := repo + "/" + artifactName + "/" + tag + "/manifest.json"
	artifactPath := artifactoryID + "/" + repoPath
	return repoPath, artifactPath, nil
}

func updateXrayMetadata(ctx context.Context, db *bun.DB, scanID uuid.UUID, externalScanID, externalStatus, currentStep string) error {
	_, err := db.NewUpdate().Model((*models.Scan)(nil)).
		Set("external_scan_id = ?", externalScanID).
		Set("external_status = ?", externalStatus).
		Where("id = ?", scanID).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to update xray metadata for scan %s: %w", scanID, err)
	}
	if err := setScanStepByID(ctx, db, scanID, currentStep); err != nil {
		return err
	}
	if message := xrayStepOutputMessage(externalStatus); message != "" {
		recordScanStepOutput(ctx, db, scanID, message)
	}
	return nil
}

func xrayStepOutputMessage(externalStatus string) string {
	switch externalStatus {
	case "warming_artifactory_cache":
		return "Warming the image through Artifactory so Xray can analyze it."
	case "indexing":
		return "Xray is indexing the artifact manifest and layers."
	case "queued":
		return "Artifact submitted to Xray and waiting in the provider queue."
	case "waiting_for_xray":
		return "Waiting for Xray to publish the final artifact summary."
	case "importing":
		return "Importing Xray findings into the JustScan report."
	case models.ScanExternalStatusBlockedByXrayPolicy:
		return "Xray blocked this artifact before the standard summary completed."
	default:
		return ""
	}
}

func persistXraySummaryFindings(ctx context.Context, db *bun.DB, scan *models.Scan, summary *xraySummaryResponse) error {
	vulns := ParseXrayVulnerabilities(summary, scan.ID)
	if len(vulns) > 0 {
		if _, err := db.NewInsert().Model(&vulns).Exec(ctx); err != nil {
			return fmt.Errorf("failed to store xray vulnerabilities: %w", err)
		}
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Stored %d Xray vulnerabilities.", len(vulns)))
	} else {
		recordScanStepOutput(ctx, db, scan.ID, "Xray returned no vulnerabilities for this artifact.")
	}

	kbEntries := ExtractXrayKBEntries(summary)
	if err := upsertXrayKBEntries(ctx, db, scan, kbEntries, "Xray"); err != nil {
		return err
	}

	severityCounts := CountSeverities(vulns)
	scan.CriticalCount = severityCounts[models.SeverityCritical]
	scan.HighCount = severityCounts[models.SeverityHigh]
	scan.MediumCount = severityCounts[models.SeverityMedium]
	scan.LowCount = severityCounts[models.SeverityLow]
	scan.UnknownCount = severityCounts[models.SeverityUnknown]

	if _, err := db.NewUpdate().Model(scan).
		Column("critical_count", "high_count", "medium_count", "low_count", "unknown_count").
		Where("id = ?", scan.ID).
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to persist xray severity counts: %w", err)
	}
	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Severity counts updated: %d critical, %d high, %d medium, %d low, %d unknown.", scan.CriticalCount, scan.HighCount, scan.MediumCount, scan.LowCount, scan.UnknownCount))

	return nil
}

func persistXrayViolationFindings(ctx context.Context, db *bun.DB, scan *models.Scan, response *xrayViolationsResponse) error {
	vulns := ParseXrayViolationVulnerabilities(response, scan.ID, scan.ImageName, scan.ImageTag)
	if len(vulns) > 0 {
		if _, err := db.NewInsert().Model(&vulns).Exec(ctx); err != nil {
			return fmt.Errorf("failed to store xray fallback vulnerabilities: %w", err)
		}
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Stored %d fallback Xray vulnerabilities from policy violations.", len(vulns)))
	} else {
		recordScanStepOutput(ctx, db, scan.ID, "Xray policy violations did not expose fallback vulnerability details.")
	}

	kbEntries := ExtractXrayViolationKBEntries(response)
	if err := upsertXrayKBEntries(ctx, db, scan, kbEntries, "Xray violation fallback"); err != nil {
		return err
	}

	severityCounts := CountSeverities(vulns)
	scan.CriticalCount = severityCounts[models.SeverityCritical]
	scan.HighCount = severityCounts[models.SeverityHigh]
	scan.MediumCount = severityCounts[models.SeverityMedium]
	scan.LowCount = severityCounts[models.SeverityLow]
	scan.UnknownCount = severityCounts[models.SeverityUnknown]

	if _, err := db.NewUpdate().Model(scan).
		Column("critical_count", "high_count", "medium_count", "low_count", "unknown_count").
		Where("id = ?", scan.ID).
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to persist xray fallback severity counts: %w", err)
	}

	return nil
}

func persistXrayCycloneDXFallback(ctx context.Context, db *bun.DB, scan *models.Scan, client *xrayClient, artifactPath, repoPath string) (int, error) {
	if scan == nil || client == nil {
		return 0, nil
	}

	sbom, exportPath, err := client.exportComponentCycloneDX(ctx, buildImageRef(scan.ImageName, scan.ImageTag), artifactPath, repoPath)
	if err != nil {
		return 0, err
	}

	components := dedupeSBOMComponents(ParseSBOMComponents(sbom, scan.ID))
	if len(components) > 0 {
		if _, err := db.NewDelete().Model((*models.SBOMComponent)(nil)).Where("scan_id = ?", scan.ID).Exec(ctx); err != nil {
			return 0, fmt.Errorf("failed to clear existing Xray SBOM components: %w", err)
		}
		if _, err := db.NewInsert().Model(&components).Exec(ctx); err != nil {
			return 0, fmt.Errorf("failed to store Xray SBOM components from fallback export: %w", err)
		}
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Stored %d Xray SBOM components from %s.", len(components), exportPath))
	}

	vulns := ParseCycloneDXVulnerabilities(sbom, scan.ID)
	if len(vulns) == 0 {
		return 0, nil
	}

	if _, err := db.NewInsert().Model(&vulns).Exec(ctx); err != nil {
		return 0, fmt.Errorf("failed to store Xray vulnerabilities from fallback export: %w", err)
	}

	kbEntries := ExtractCycloneDXKBEntries(sbom)
	if err := upsertXrayKBEntries(ctx, db, scan, kbEntries, "Xray CycloneDX fallback"); err != nil {
		return 0, err
	}

	severityCounts := CountSeverities(vulns)
	scan.CriticalCount = severityCounts[models.SeverityCritical]
	scan.HighCount = severityCounts[models.SeverityHigh]
	scan.MediumCount = severityCounts[models.SeverityMedium]
	scan.LowCount = severityCounts[models.SeverityLow]
	scan.UnknownCount = severityCounts[models.SeverityUnknown]

	if _, err := db.NewUpdate().Model(scan).
		Column("critical_count", "high_count", "medium_count", "low_count", "unknown_count").
		Where("id = ?", scan.ID).
		Exec(ctx); err != nil {
		return 0, fmt.Errorf("failed to persist xray CycloneDX fallback severity counts: %w", err)
	}

	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Stored %d Xray vulnerabilities from %s.", len(vulns), exportPath))
	return len(vulns), nil
}

func upsertXrayKBEntries(ctx context.Context, db *bun.DB, scan *models.Scan, entries []models.VulnKBEntry, source string) error {
	if len(entries) == 0 {
		return nil
	}
	if err := upsertKBEntries(ctx, db, entries); err != nil {
		log.Warnf("%s KB upsert failed for scan %s (non-fatal): %v", source, scan.ID, err)
		return nil
	}
	log.Debugf("Upserted %d %s KB entries for scan %s", len(entries), source, scan.ID)
	return nil
}

func persistXraySBOMComponents(ctx context.Context, db *bun.DB, scan *models.Scan, client *xrayClient, artifactPath, repoPath string) error {
	if scan == nil || client == nil {
		return nil
	}

	sbom, exportPath, err := client.exportComponentCycloneDX(ctx, buildImageRef(scan.ImageName, scan.ImageTag), artifactPath, repoPath)
	if err != nil {
		return err
	}

	components := dedupeSBOMComponents(ParseSBOMComponents(sbom, scan.ID))
	if len(components) == 0 {
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Xray component export for %s did not return SBOM components.", exportPath))
		return nil
	}

	if _, err := db.NewDelete().Model((*models.SBOMComponent)(nil)).Where("scan_id = ?", scan.ID).Exec(ctx); err != nil {
		return fmt.Errorf("failed to clear existing Xray SBOM components: %w", err)
	}
	if _, err := db.NewInsert().Model(&components).Exec(ctx); err != nil {
		return fmt.Errorf("failed to store Xray SBOM components: %w", err)
	}

	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Stored %d Xray SBOM components from %s.", len(components), exportPath))
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
					ScanID:              scanID,
					VulnID:              vulnID,
					PkgName:             pkgName,
					InstalledVersion:    component.Version,
					FixedVersion:        strings.Join(component.FixedVersions, ", "),
					Severity:            normalizeXraySeverity(issue.Severity),
					Title:               issue.Summary,
					Description:         issue.Description,
					References:          xrayReferences(issue.References),
					DataSource:          xrayDataSource,
					ExternalComponentID: strings.TrimSpace(component.ComponentID),
					CVSSScore:           score,
					CVSSVector:          vector,
				})
			}
		}
	}

	return vulns
}

func ParseXrayViolationVulnerabilities(response *xrayViolationsResponse, scanID uuid.UUID, fallbackPackage, fallbackVersion string) []models.Vulnerability {
	if response == nil {
		return nil
	}

	seen := make(map[string]bool)
	vulns := make([]models.Vulnerability, 0, len(response.Violations))
	for _, violation := range response.Violations {
		vulnID := strings.TrimSpace(violation.IssueID)
		if vulnID == "" {
			vulnID = strings.TrimSpace(violation.ID)
		}
		if vulnID == "" {
			vulnID = "XRAY-BLOCKED-UNKNOWN"
		}

		pkgName := strings.TrimSpace(fallbackPackage)
		if pkgName == "" {
			pkgName = "blocked-artifact"
		}

		key := vulnID + "|" + pkgName + "|" + strings.TrimSpace(fallbackVersion)
		if seen[key] {
			continue
		}
		seen[key] = true

		vulns = append(vulns, models.Vulnerability{
			ScanID:           scanID,
			VulnID:           vulnID,
			PkgName:          pkgName,
			InstalledVersion: strings.TrimSpace(fallbackVersion),
			Severity:         normalizeXraySeverity(violation.Severity),
			Title:            strings.TrimSpace(violation.Summary),
			Description:      strings.TrimSpace(violation.Description),
			References:       nil,
			DataSource:       xrayDataSource,
		})
	}

	return vulns
}

func ParseCycloneDXVulnerabilities(sbom *TrivySBOMOutput, scanID uuid.UUID) []models.Vulnerability {
	if sbom == nil || len(sbom.Vulnerabilities) == 0 {
		return nil
	}

	componentByRef := make(map[string]TrivySBOMComp, len(sbom.Components))
	for _, component := range sbom.Components {
		if ref := strings.TrimSpace(component.BOMRef); ref != "" {
			componentByRef[ref] = component
		}
	}

	seen := make(map[string]bool)
	vulns := make([]models.Vulnerability, 0, len(sbom.Vulnerabilities))
	for _, vulnerability := range sbom.Vulnerabilities {
		vulnID := strings.TrimSpace(vulnerability.ID)
		if vulnID == "" && vulnerability.Source != nil {
			vulnID = strings.TrimSpace(vulnerability.Source.Name)
		}
		if vulnID == "" {
			vulnID = "XRAY-CYCLONEDX-UNKNOWN"
		}

		severity, score, vector := cycloneDXVulnerabilityScore(vulnerability)
		references := cycloneDXVulnerabilityReferences(vulnerability)
		affects := vulnerability.Affects
		if len(affects) == 0 {
			affects = []TrivySBOMVulnerabilityAffect{{}}
		}

		for _, affect := range affects {
			component := componentByRef[strings.TrimSpace(affect.Ref)]
			pkgName := strings.TrimSpace(component.Name)
			if pkgName == "" {
				pkgName = "unknown"
			}
			version := strings.TrimSpace(component.Version)
			key := vulnID + "|" + pkgName + "|" + version
			if seen[key] {
				continue
			}
			seen[key] = true

			vulns = append(vulns, models.Vulnerability{
				ScanID:           scanID,
				VulnID:           vulnID,
				PkgName:          pkgName,
				InstalledVersion: version,
				Severity:         severity,
				Title:            strings.TrimSpace(vulnerability.Recommendation),
				Description:      strings.TrimSpace(vulnerability.Description),
				References:       references,
				DataSource:       xrayDataSource,
				CVSSScore:        score,
				CVSSVector:       vector,
			})
		}
	}

	return vulns
}

func cycloneDXVulnerabilityScore(vulnerability TrivySBOMVulnerability) (string, float64, string) {
	severity := models.SeverityUnknown
	bestScore := 0.0
	bestVector := ""

	for _, rating := range vulnerability.Ratings {
		normalizedSeverity := normalizeXraySeverity(rating.Severity)
		if xraySeverityRank(normalizedSeverity) > xraySeverityRank(severity) {
			severity = normalizedSeverity
		}
		if score, ok := xrayNumericValue(rating.Score); ok && score > bestScore {
			bestScore = score
			bestVector = strings.TrimSpace(rating.Vector)
		}
	}

	return severity, bestScore, bestVector
}

func cycloneDXVulnerabilityReferences(vulnerability TrivySBOMVulnerability) []string {
	seen := make(map[string]bool)
	references := make([]string, 0, len(vulnerability.Advisories)+1)
	for _, advisory := range vulnerability.Advisories {
		url := strings.TrimSpace(advisory.URL)
		if url == "" || seen[url] {
			continue
		}
		seen[url] = true
		references = append(references, url)
	}
	if vulnerability.Source != nil {
		url := strings.TrimSpace(vulnerability.Source.URL)
		if url != "" && !seen[url] {
			references = append(references, url)
		}
	}
	return references
}

func ExtractXrayKBEntries(summary *xraySummaryResponse) []models.VulnKBEntry {
	if summary == nil {
		return nil
	}

	seen := make(map[string]*models.VulnKBEntry)
	for _, artifact := range summary.Artifacts {
		for _, issue := range artifact.Issues {
			vulnID := xrayIssueID(issue)
			if vulnID == "" {
				continue
			}

			refs := xrayKBReferences(issue.References)
			score, vector := xrayIssueScore(issue)
			severity := normalizeXraySeverity(issue.Severity)

			entry, exists := seen[vulnID]
			if !exists {
				entry = &models.VulnKBEntry{
					VulnID:           vulnID,
					Description:      issue.Description,
					Severity:         severity,
					CVSSScore:        score,
					CVSSVector:       vector,
					References:       refs,
					ExploitAvailable: kbRefsContainExploit(refs),
				}
				seen[vulnID] = entry
				continue
			}

			if entry.Description == "" && issue.Description != "" {
				entry.Description = issue.Description
			}
			if xraySeverityRank(severity) > xraySeverityRank(entry.Severity) {
				entry.Severity = severity
			}
			if score > entry.CVSSScore {
				entry.CVSSScore = score
				entry.CVSSVector = vector
			}
			entry.References = mergeKBRefs(entry.References, refs)
			entry.ExploitAvailable = entry.ExploitAvailable || kbRefsContainExploit(refs)
		}
	}

	entries := make([]models.VulnKBEntry, 0, len(seen))
	for _, entry := range seen {
		entries = append(entries, *entry)
	}
	return entries
}

func ExtractXrayViolationKBEntries(response *xrayViolationsResponse) []models.VulnKBEntry {
	if response == nil {
		return nil
	}

	seen := make(map[string]*models.VulnKBEntry)
	for _, violation := range response.Violations {
		vulnID := strings.TrimSpace(violation.IssueID)
		if vulnID == "" {
			vulnID = strings.TrimSpace(violation.ID)
		}
		if vulnID == "" {
			continue
		}

		severity := normalizeXraySeverity(violation.Severity)
		entry, exists := seen[vulnID]
		if !exists {
			entry = &models.VulnKBEntry{
				VulnID:      vulnID,
				Description: strings.TrimSpace(violation.Description),
				Severity:    severity,
			}
			seen[vulnID] = entry
			continue
		}

		if entry.Description == "" && strings.TrimSpace(violation.Description) != "" {
			entry.Description = strings.TrimSpace(violation.Description)
		}
		if xraySeverityRank(severity) > xraySeverityRank(entry.Severity) {
			entry.Severity = severity
		}
	}

	entries := make([]models.VulnKBEntry, 0, len(seen))
	for _, entry := range seen {
		entries = append(entries, *entry)
	}
	return entries
}

func ExtractCycloneDXKBEntries(sbom *TrivySBOMOutput) []models.VulnKBEntry {
	if sbom == nil || len(sbom.Vulnerabilities) == 0 {
		return nil
	}

	seen := make(map[string]*models.VulnKBEntry)
	for _, vulnerability := range sbom.Vulnerabilities {
		vulnID := strings.TrimSpace(vulnerability.ID)
		if vulnID == "" && vulnerability.Source != nil {
			vulnID = strings.TrimSpace(vulnerability.Source.Name)
		}
		if vulnID == "" {
			continue
		}

		severity, score, vector := cycloneDXVulnerabilityScore(vulnerability)
		refs := cycloneDXKBReferences(vulnerability)

		entry, exists := seen[vulnID]
		if !exists {
			seen[vulnID] = &models.VulnKBEntry{
				VulnID:           vulnID,
				Description:      strings.TrimSpace(vulnerability.Description),
				Severity:         severity,
				CVSSScore:        score,
				CVSSVector:       vector,
				References:       refs,
				ExploitAvailable: kbRefsContainExploit(refs),
			}
			continue
		}

		if entry.Description == "" && strings.TrimSpace(vulnerability.Description) != "" {
			entry.Description = strings.TrimSpace(vulnerability.Description)
		}
		if xraySeverityRank(severity) > xraySeverityRank(entry.Severity) {
			entry.Severity = severity
		}
		if score > entry.CVSSScore {
			entry.CVSSScore = score
			entry.CVSSVector = vector
		}
		entry.References = mergeKBRefs(entry.References, refs)
		entry.ExploitAvailable = entry.ExploitAvailable || kbRefsContainExploit(refs)
	}

	entries := make([]models.VulnKBEntry, 0, len(seen))
	for _, entry := range seen {
		entries = append(entries, *entry)
	}
	return entries
}

func cycloneDXKBReferences(vulnerability TrivySBOMVulnerability) []models.KBRef {
	seen := make(map[string]bool)
	refs := make([]models.KBRef, 0, len(vulnerability.Advisories)+1)
	appendRef := func(url, source string) {
		url = strings.TrimSpace(url)
		source = strings.TrimSpace(source)
		if url == "" || seen[url+"|"+source] {
			return
		}
		seen[url+"|"+source] = true
		refs = append(refs, models.KBRef{URL: url, Source: source})
	}

	for _, advisory := range vulnerability.Advisories {
		appendRef(advisory.URL, "CycloneDX Advisory")
	}
	if vulnerability.Source != nil {
		appendRef(vulnerability.Source.URL, strings.TrimSpace(vulnerability.Source.Name))
	}
	return refs
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

func shouldWarnBlockedReindexError(err error) bool {
	var httpErr *xrayHTTPError
	if !errors.As(err, &httpErr) {
		return true
	}

	switch httpErr.StatusCode {
	case http.StatusForbidden, http.StatusUnauthorized, http.StatusConflict:
		return false
	default:
		return true
	}
}

func isRetriableRegistryWarmupError(err error) bool {
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

	var httpErr *registryHTTPError
	if !errors.As(err, &httpErr) {
		return false
	}

	switch httpErr.StatusCode {
	case http.StatusRequestTimeout, http.StatusTooManyRequests, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
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
	bestScore := 0.0
	bestVector := ""

	for _, cve := range issue.CVEs {
		if score, vector, ok := xrayCVEScore(cve); ok && score > bestScore {
			bestScore = score
			bestVector = vector
		}
	}

	if bestScore > 0 {
		return bestScore, bestVector
	}

	if score, ok := xrayNumericValue(issue.CVSS3Max); ok && score > 0 {
		return score, ""
	}
	if score, ok := xrayNumericValue(issue.CVSS2Max); ok && score > 0 {
		return score, ""
	}

	return 0, ""
}

func xrayCVEScore(cve xraySummaryCVE) (float64, string, bool) {
	if score, vector, ok := xrayScoreVector(cve.CVSSV3Score, cve.CVSSV3Vector); ok {
		return score, vector, true
	}
	if score, vector, ok := xrayCombinedScoreVector(cve.CVSSV3); ok {
		return score, vector, true
	}
	if score, vector, ok := xrayScoreVector(cve.CVSSScore, cve.CVSSVector); ok {
		return score, vector, true
	}
	if score, vector, ok := xrayScoreVector(cve.CVSSV2Score, cve.CVSSV2Vector); ok {
		return score, vector, true
	}
	if score, vector, ok := xrayCombinedScoreVector(cve.CVSSV2); ok {
		return score, vector, true
	}
	return 0, "", false
}

func xrayScoreVector(raw any, vector string) (float64, string, bool) {
	score, ok := xrayNumericValue(raw)
	if !ok || score <= 0 {
		return 0, "", false
	}
	return score, strings.TrimSpace(vector), true
}

func xrayCombinedScoreVector(raw any) (float64, string, bool) {
	text, ok := xrayStringValue(raw)
	if !ok {
		return 0, "", false
	}

	text = strings.TrimSpace(text)
	if text == "" {
		return 0, "", false
	}

	scorePart, vectorPart, hasVector := strings.Cut(text, "/")
	score, err := strconv.ParseFloat(strings.TrimSpace(scorePart), 64)
	if err != nil || score <= 0 {
		return 0, "", false
	}

	if !hasVector {
		return score, "", true
	}

	return score, strings.TrimSpace(vectorPart), true
}

func xrayNumericValue(raw any) (float64, bool) {
	switch value := raw.(type) {
	case nil:
		return 0, false
	case float64:
		return value, true
	case float32:
		return float64(value), true
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	case json.Number:
		parsed, err := value.Float64()
		if err != nil {
			return 0, false
		}
		return parsed, true
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

func xrayStringValue(raw any) (string, bool) {
	switch value := raw.(type) {
	case nil:
		return "", false
	case string:
		return value, true
	case json.Number:
		return value.String(), true
	default:
		return "", false
	}
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

func xraySeverityRank(severity string) int {
	switch normalizeXraySeverity(severity) {
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

func hasMissingXraySummaryError(summary *xraySummaryResponse) bool {
	if summary == nil {
		return false
	}

	for _, item := range summary.Errors {
		normalized := strings.ToLower(strings.TrimSpace(item.Error))
		if normalized == "" {
			continue
		}
		if strings.Contains(normalized, "artifact doesn't exist") || strings.Contains(normalized, "not indexed/cached in xray") {
			return true
		}
	}

	return false
}

func normalizeRegistryContentType(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if idx := strings.Index(trimmed, ";"); idx >= 0 {
		trimmed = trimmed[:idx]
	}
	return strings.TrimSpace(trimmed)
}

func isRegistryManifestIndex(mediaType string, manifest *registryManifest) bool {
	if manifest == nil {
		return false
	}
	normalized := normalizeRegistryContentType(mediaType)
	return normalized == "application/vnd.oci.image.index.v1+json" || normalized == "application/vnd.docker.distribution.manifest.list.v2+json" || len(manifest.Manifests) > 0
}

func selectManifestDescriptors(items []registryManifestDescriptor, platform string) []registryManifestDescriptor {
	if len(items) == 0 {
		return nil
	}

	if platform != "" {
		var matched []registryManifestDescriptor
		for _, item := range items {
			if manifestDescriptorMatchesPlatform(item, platform) {
				matched = append(matched, item)
			}
		}
		if len(matched) > 0 {
			return matched
		}
	}

	for _, item := range items {
		if manifestDescriptorMatchesPlatform(item, "linux/amd64") {
			return []registryManifestDescriptor{item}
		}
	}

	return []registryManifestDescriptor{items[0]}
}

func manifestDescriptorMatchesPlatform(item registryManifestDescriptor, platform string) bool {
	if item.Platform == nil || strings.TrimSpace(platform) == "" {
		return false
	}
	parts := strings.Split(strings.TrimSpace(platform), "/")
	if len(parts) < 2 {
		return false
	}
	if !strings.EqualFold(item.Platform.OS, parts[0]) || !strings.EqualFold(item.Platform.Architecture, parts[1]) {
		return false
	}
	if len(parts) >= 3 {
		return strings.EqualFold(item.Platform.Variant, parts[2])
	}
	return true
}

func registryManifestPath(imageRepoPath, reference string) string {
	return "/v2/" + strings.TrimPrefix(imageRepoPath, "/") + "/manifests/" + url.PathEscape(reference)
}

func registryBlobPath(imageRepoPath, digest string) string {
	return "/v2/" + strings.TrimPrefix(imageRepoPath, "/") + "/blobs/" + url.PathEscape(digest)
}

func formatXraySummaryErrors(items []xraySummaryError) string {
	if len(items) == 0 {
		return "artifact summary remained empty"
	}

	parts := make([]string, 0, len(items))
	for _, item := range items {
		message := strings.TrimSpace(item.Error)
		if message == "" {
			continue
		}
		if item.Identifier != "" {
			parts = append(parts, item.Identifier+": "+message)
			continue
		}
		parts = append(parts, message)
	}
	if len(parts) == 0 {
		return "artifact summary remained empty"
	}
	return strings.Join(parts, "; ")
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

func xrayKBReferences(values []any) []models.KBRef {
	refs := make([]models.KBRef, 0, len(values))
	for _, value := range values {
		switch typed := value.(type) {
		case string:
			trimmed := strings.TrimSpace(typed)
			if trimmed != "" {
				refs = append(refs, models.KBRef{URL: trimmed, Source: xrayDataSource})
			}
		case map[string]any:
			urlValue := ""
			for _, key := range []string{"url", "reference", "href"} {
				candidate, _ := typed[key].(string)
				candidate = strings.TrimSpace(candidate)
				if candidate != "" {
					urlValue = candidate
					break
				}
			}
			if urlValue == "" {
				continue
			}

			source := xrayDataSource
			for _, key := range []string{"source", "name", "provider"} {
				candidate, _ := typed[key].(string)
				candidate = strings.TrimSpace(candidate)
				if candidate != "" {
					source = candidate
					break
				}
			}
			refs = append(refs, models.KBRef{URL: urlValue, Source: source})
		}
	}
	return mergeKBRefs(nil, refs)
}

func xrayImageMetadataFields(config models.JSONObject) (string, string, string) {
	architecture := xrayJSONObjectString(config, "architecture")
	osValue := xrayJSONObjectString(config, "os")
	if osValue == "" {
		return architecture, "", ""
	}
	return architecture, osValue, osValue
}

func xrayJSONObjectString(value models.JSONObject, key string) string {
	if value == nil {
		return ""
	}
	raw, ok := value[key]
	if !ok || raw == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(raw))
}

func parseXrayCycloneDXExport(payload []byte) (*TrivySBOMOutput, error) {
	reader, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return nil, fmt.Errorf("failed to open Xray export ZIP: %w", err)
	}

	for _, file := range reader.File {
		if !strings.HasSuffix(strings.ToLower(file.Name), ".json") {
			continue
		}
		handle, err := file.Open()
		if err != nil {
			return nil, fmt.Errorf("failed to open %s in Xray export ZIP: %w", file.Name, err)
		}
		body, readErr := io.ReadAll(handle)
		handle.Close()
		if readErr != nil {
			return nil, fmt.Errorf("failed to read %s in Xray export ZIP: %w", file.Name, readErr)
		}

		var sbom TrivySBOMOutput
		if err := json.Unmarshal(body, &sbom); err != nil {
			continue
		}
		if strings.TrimSpace(sbom.BOMFormat) == "" && len(sbom.Components) == 0 {
			continue
		}
		return &sbom, nil
	}

	return nil, fmt.Errorf("no CycloneDX JSON document found in Xray export ZIP")
}

func dedupeSBOMComponents(components []models.SBOMComponent) []models.SBOMComponent {
	if len(components) == 0 {
		return nil
	}

	unique := make([]models.SBOMComponent, 0, len(components))
	seen := make(map[string]bool, len(components))
	for _, component := range components {
		key := strings.TrimSpace(component.PackageURL)
		if key == "" {
			key = component.Name + "|" + component.Version + "|" + component.Type
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		unique = append(unique, component)
	}

	return unique
}
