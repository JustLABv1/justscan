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
	effectivesuppressions "justscan-backend/functions/suppressions"
	"justscan-backend/notifications"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

const xrayDataSource = "JFrog Xray"

const xrayRequestTimeout = 90 * time.Second
const registryRequestTimeout = 5 * time.Minute
const xraySummaryPollInterval = 10 * time.Second
const xrayMissingArtifactWindow = 2 * time.Minute
const xrayBlockedSummaryWaitWindow = 45 * time.Second
const xrayFreshScanSettleDelay = 8 * time.Second
const registryWarmupRetryInterval = 10 * time.Second

// Set to 0 to disable truncation and persist full request/response bodies.
const xrayRequestLogBodyLimit = 0

type xrayClient struct {
	baseURL            string
	registryURL        string
	artifactoryID      string
	authType           string
	username           string
	secret             string
	httpClient         *http.Client
	registryHTTPClient *http.Client
	db                 *bun.DB
	registryID         *uuid.UUID
}

type RegistryXrayTestClient struct {
	client *xrayClient
}

type ArtifactoryRepository struct {
	Key         string `json:"key"`
	PackageType string `json:"package_type,omitempty"`
	Class       string `json:"class,omitempty"`
	Description string `json:"description,omitempty"`
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

type xraySummaryArtifactGeneral struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type xraySummaryArtifact struct {
	General xraySummaryArtifactGeneral `json:"general"`
	Issues  []xraySummaryIssue         `json:"issues"`
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
	OutputFormat      string `json:"output_format,omitempty"`
	CycloneDX         bool   `json:"cyclonedx,omitempty"`
	CycloneDXFormat   string `json:"cyclonedx_format,omitempty"`
	License           bool   `json:"license,omitempty"`
	LicenseResolution bool   `json:"license_resolution,omitempty"`
	Vulnerabilities   bool   `json:"vulnerabilities,omitempty"`
	Violations        bool   `json:"violations,omitempty"`
	IncludeIgnored    bool   `json:"include_ignored_violations,omitempty"`
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

type xrayIgnoreRule struct {
	RuleID        string
	PolicyName    string
	WatchName     string
	Justification string
	ExpiresAt     *time.Time
	Raw           models.JSONObject
}

type xrayExportIgnoreRule struct {
	VulnID string
	Rule   xrayIgnoreRule
}

type xrayViolationRecord struct {
	ID                     string                `json:"violation_id,omitempty"`
	IssueID                string                `json:"issue_id,omitempty"`
	WatchID                string                `json:"watcher_id,omitempty"`
	Watch                  string                `json:"watch_name,omitempty"`
	Summary                string                `json:"summary,omitempty"`
	Description            string                `json:"description,omitempty"`
	Severity               string                `json:"severity,omitempty"`
	ImpactArtifacts        []string              `json:"impact_artifacts,omitempty"`
	ComponentPhysicalPaths []string              `json:"component_physical_paths,omitempty"`
	Source                 string                `json:"source,omitempty"`
	SourceVersion          string                `json:"source_version,omitempty"`
	SourceID               string                `json:"source_id,omitempty"`
	IsBlocking             bool                  `json:"is_blocking,omitempty"`
	Raw                    models.JSONObject     `json:"raw,omitempty"`
	Policies               []xrayViolationPolicy `json:"matched_policies,omitempty"`
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

type xrayArtifactPathCandidate struct {
	Repository   string
	Path         string
	RepoPath     string
	ArtifactPath string
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

	client, err := newXrayClient(registry, db, scan.RegistryID)
	if err != nil {
		return err
	}
	ctx = xrayScanContext(ctx, scan.ID, scan.RegistryID)

	repoKey, artifactName, imageTag, err := xrayImageParts(scan.ImageName, scan.ImageTag, registry)
	if err != nil {
		return err
	}

	exportComponentName := xrayExportComponentName(artifactName, imageTag, scan.ImageDigest)

	imageRepoPath := repoKey + "/" + artifactName
	manifestFilename := client.resolveManifestFilename(ctx, imageRepoPath, imageTag)
	artifactCandidates := buildXrayArtifactPathCandidates(client.artifactoryID, repoKey, artifactName, imageTag, manifestFilename, "")
	selectedCandidate := preferredXrayArtifactCandidate(artifactCandidates)
	artifactRepoPath := selectedCandidate.Path
	repoPath := selectedCandidate.RepoPath
	artifactPath := selectedCandidate.ArtifactPath
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
		exportComponentName = xrayExportComponentName(artifactName, imageTag, scan.ImageDigest)
		artifactCandidates = buildXrayArtifactPathCandidates(client.artifactoryID, repoKey, artifactName, imageTag, manifestFilename, resolvedDigest)
		selectedCandidate = preferredXrayArtifactCandidate(artifactCandidates)
		artifactRepoPath = selectedCandidate.Path
		repoPath = selectedCandidate.RepoPath
		artifactPath = selectedCandidate.ArtifactPath
		if _, err := db.NewUpdate().Model(scan).
			Column("image_digest").
			Where("id = ?", scan.ID).
			Exec(ctx); err != nil {
			return fmt.Errorf("failed to persist xray image digest: %w", err)
		}
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Resolved image digest %s for suppression and reporting.", resolvedDigest))
	}

	componentID := "docker://" + exportComponentName
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

			// Trigger re-index then poll summary/artifact to get the authoritative
			// component name and path from Xray before building any exportDetails requests.
			client.bestEffortTriggerBlockedArtifactScan(ctx, componentID, targets)
			recordScanStepOutput(ctx, db, scan.ID, "Triggered best-effort blocked-artifact indexing so any available findings can still be imported.")

			var blockedSummary *xraySummaryResponse
			if summary, blockedArtifactPath, summaryErr := client.bestEffortBlockedArtifactSummary(ctx, targets); summaryErr != nil {
				log.Warnf("Failed to fetch Xray artifact summary for blocked scan %s: %v", scan.ID, summaryErr)
			} else if summary != nil {
				blockedSummary = summary
				recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Fetched a blocked-artifact summary from %s.", blockedArtifactPath))
				// Update export identifiers to the canonical values Xray returned in
				// the summary response so all subsequent exportDetails calls are correct.
				if resolvedName, resolvedPath := xraySummaryExportDetails(summary, client.artifactoryID); resolvedName != "" {
					exportComponentName = resolvedName
					if resolvedPath != "" {
						repoPath = resolvedPath
						artifactPath = resolvedPath
					}
				}
			}

			violations, violationsErr := client.getViolations(ctx, targets)
			if violationsErr != nil || violations == nil || len(violations.Violations) == 0 {
				exportPaths := append([]string{artifactPath}, blockedArtifactSummaryPaths(client.artifactoryID, targets)...)
				if exportViolations, exportErr := client.exportViolations(ctx, exportComponentName, exportPaths...); exportErr == nil && exportViolations != nil && len(exportViolations.Violations) > 0 {
					violations = exportViolations
					violationsErr = nil
					recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Recovered %d policy violations from Xray export details.", len(exportViolations.Violations)))
				}
			}
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

			if blockedSummary != nil {
				if err := persistXraySummaryFindings(ctx, db, scan, blockedSummary); err != nil {
					log.Warnf("Failed to persist Xray findings for blocked scan %s: %v", scan.ID, err)
					recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Failed to persist blocked Xray findings: %v", err))
				} else {
					log.Infof("Imported Xray vulnerabilities for blocked scan %s", scan.ID)
					recordScanStepOutput(ctx, db, scan.ID, "Imported available findings from the blocked Xray artifact summary.")
				}
				if err := persistXrayViolationContext(ctx, db, scan, violations); err != nil {
					log.Warnf("Failed to persist Xray violation context for blocked scan %s (non-fatal): %v", scan.ID, err)
					recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Failed to persist blocked Xray violation context: %v", err))
				} else {
					recordScanStepOutput(ctx, db, scan.ID, "Stored blocked Xray violation context for policy reporting.")
				}
			}

			if scan.CriticalCount+scan.HighCount+scan.MediumCount+scan.LowCount+scan.UnknownCount == 0 {
				if recoveredCount, exportErr := persistXrayCycloneDXFallback(ctx, db, scan, client, exportComponentName, artifactPath, repoPath); exportErr != nil {
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
			} else if err := persistXraySBOMComponents(ctx, db, scan, client, exportComponentName, artifactPath, repoPath); err != nil {
				log.Warnf("Failed to persist Xray SBOM components for blocked scan %s: %v", scan.ID, err)
				recordScanStepOutput(ctx, db, scan.ID, describeNonFatalXraySBOMImportError(err))
			} else {
				recordScanStepOutput(ctx, db, scan.ID, "Imported available Xray SBOM component details for the blocked artifact.")
			}

			if err := persistXrayIgnoreRuleSnapshots(ctx, db, scan, client, exportComponentName, repoPath, artifactPath); err != nil {
				log.Warnf("Failed to persist Xray ignore-rule snapshots for blocked scan %s: %v", scan.ID, err)
				recordScanStepOutput(ctx, db, scan.ID, describeNonFatalXrayIgnoreRuleSyncError(err))
			}
			if suppressedCount, err := effectivesuppressions.RecalculateSuppressedCount(ctx, db, scan); err != nil {
				log.Warnf("Failed to recalculate suppressed count for blocked scan %s: %v", scan.ID, err)
				recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Suppression count recalculation failed for the blocked scan: %v", err))
			} else {
				scan.SuppressedCount = suppressedCount
				recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Suppression count recalculated for blocked scan: %d findings suppressed.", suppressedCount))
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
		var httpErr *xrayHTTPError
		if !errors.As(err, &httpErr) || httpErr.StatusCode != http.StatusConflict {
			return fmt.Errorf("failed to trigger a fresh xray index run for %s: %w", repoPath, err)
		}
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Xray reported that %s is already being indexed. Continuing with the current in-flight indexing run.", repoPath))
	}

	if err := updateXrayMetadata(ctx, db, scan.ID, componentID, "queued", models.ScanStepQueuedInXray); err != nil {
		return err
	}
	scan.ExternalStatus = "queued"
	scan.CurrentStep = models.ScanStepQueuedInXray
	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Submitted the artifact scan request for component %s.", componentID))

	if err := client.scanArtifact(ctx, componentID); err != nil {
		var httpErr *xrayHTTPError
		if !errors.As(err, &httpErr) || httpErr.StatusCode != http.StatusConflict {
			return fmt.Errorf("failed to trigger a fresh xray scanArtifact run for %s: %w", componentID, err)
		}
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Xray reported that %s is already queued or scanning. Continuing with the current in-flight scan run.", componentID))
	}

	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Waiting %s before polling Xray summary so we import from the active scan run.", xrayFreshScanSettleDelay))
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(xrayFreshScanSettleDelay):
	}

	if err := updateXrayMetadata(ctx, db, scan.ID, componentID, "waiting_for_xray", models.ScanStepWaitingForXray); err != nil {
		return err
	}
	scan.ExternalStatus = "waiting_for_xray"
	scan.CurrentStep = models.ScanStepWaitingForXray
	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Polling Xray for the artifact summary at %s.", artifactPath))

	summary, resolvedArtifact, err := client.pollArtifactSummary(ctx, artifactCandidates)
	if err != nil {
		return err
	}
	artifactRepoPath = resolvedArtifact.Path
	repoPath = resolvedArtifact.RepoPath
	artifactPath = resolvedArtifact.ArtifactPath

	if err := updateXrayMetadata(ctx, db, scan.ID, componentID, "importing", models.ScanStepImportingResults); err != nil {
		return err
	}
	scan.ExternalStatus = "importing"
	scan.CurrentStep = models.ScanStepImportingResults
	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Xray returned %d artifact summaries. Importing findings now.", len(summary.Artifacts)))

	if err := persistXraySummaryFindings(ctx, db, scan, summary); err != nil {
		return err
	}
	if violationContext, exportErr := client.exportViolations(ctx, exportComponentName, artifactPath, repoPath); exportErr != nil {
		log.Warnf("Failed to fetch Xray exportDetails violation context for scan %s (non-fatal): %v", scan.ID, exportErr)
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Xray violation context export failed but vulnerability import can continue: %v", exportErr))
	} else if err := persistXrayViolationContext(ctx, db, scan, violationContext); err != nil {
		log.Warnf("Failed to persist Xray violation context for scan %s (non-fatal): %v", scan.ID, err)
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Xray violation context persistence failed but vulnerability import can continue: %v", err))
	} else {
		recordScanStepOutput(ctx, db, scan.ID, "Stored Xray violation context for policy reporting.")
	}
	if err := persistXraySBOMComponents(ctx, db, scan, client, exportComponentName, artifactPath, repoPath); err != nil {
		log.Warnf("Failed to persist Xray SBOM components for scan %s (non-fatal): %v", scan.ID, err)
		recordScanStepOutput(ctx, db, scan.ID, describeNonFatalXraySBOMImportError(err))
	} else {
		recordScanStepOutput(ctx, db, scan.ID, "Imported Xray SBOM component details.")
	}
	if err := persistXrayIgnoreRuleSnapshots(ctx, db, scan, client, exportComponentName, repoPath, artifactPath); err != nil {
		log.Warnf("Failed to persist Xray ignore-rule snapshots for scan %s (non-fatal): %v", scan.ID, err)
		recordScanStepOutput(ctx, db, scan.ID, describeNonFatalXrayIgnoreRuleSyncError(err))
	}
	if suppressedCount, err := effectivesuppressions.RecalculateSuppressedCount(ctx, db, scan); err != nil {
		log.Warnf("Failed to recalculate suppressed count for scan %s: %v", scan.ID, err)
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Suppression count recalculation failed but the report can still be saved: %v", err))
	} else {
		scan.SuppressedCount = suppressedCount
		recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Suppression count recalculated: %d findings suppressed.", suppressedCount))
	}

	completedAt := time.Now()
	scan.Status = models.ScanStatusCompleted
	scan.CompletedAt = &completedAt
	scan.ExternalStatus = "completed"
	scan.CurrentStep = models.ScanStepCompleted

	if _, err := db.NewUpdate().Model(scan).
		Column("status", "completed_at", "critical_count", "high_count", "medium_count", "low_count", "unknown_count", "suppressed_count", "external_scan_id", "external_status", "image_config", "architecture", "os_family", "os_name").
		Where("id = ?", scan.ID).
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to mark xray scan as completed: %w", err)
	}
	if err := setScanStep(ctx, db, scan, models.ScanStepCompleted); err != nil {
		return err
	}
	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Xray scan completed with %d total findings.", scan.CriticalCount+scan.HighCount+scan.MediumCount+scan.LowCount+scan.UnknownCount))
	recordScanStepOutput(ctx, db, scan.ID, "Queued org auto-assignment, compliance evaluation, auto-tagging, and completion notifications.")

	go compliance.AutoAssignOrgs(db, scan.ImageName, scan.ImageTag, scan.ID)
	go applyAutoTags(db, scan)
	notifications.Dispatch(db, models.NotificationEventScanComplete, notifications.Payload{
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

	client, err := newXrayClient(registry, nil, nil)
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

func newXrayClient(registry *models.Registry, db *bun.DB, registryID *uuid.UUID) (*xrayClient, error) {
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
		baseURL:            baseURL,
		registryURL:        strings.TrimRight(strings.TrimSpace(registry.URL), "/"),
		artifactoryID:      artifactoryID,
		authType:           registry.AuthType,
		username:           registry.Username,
		secret:             secret,
		httpClient:         &http.Client{Timeout: xrayRequestTimeout},
		registryHTTPClient: &http.Client{Timeout: registryRequestTimeout},
		db:                 db,
		registryID:         registryID,
	}, nil
}

func NewRegistryXrayTestClient(registry *models.Registry) (*RegistryXrayTestClient, error) {
	client, err := newXrayClient(registry, nil, nil)
	if err != nil {
		return nil, err
	}
	return &RegistryXrayTestClient{client: client}, nil
}

func (c *RegistryXrayTestClient) Ping(ctx context.Context) error {
	return c.client.ping(ctx)
}

func (c *RegistryXrayTestClient) ListDockerRepositories(ctx context.Context) ([]ArtifactoryRepository, error) {
	return c.client.listDockerRepositories(ctx)
}

func (c *xrayClient) ping(ctx context.Context) error {
	_, err := c.doJSON(ctx, http.MethodGet, "/xray/api/v1/system/ping", nil, nil, http.StatusOK)
	return err
}

func (c *xrayClient) listDockerRepositories(ctx context.Context) ([]ArtifactoryRepository, error) {
	type artifactoryRepositoryResponse struct {
		Key         string `json:"key"`
		PackageType string `json:"packageType"`
		Class       string `json:"rclass"`
		Description string `json:"description"`
	}

	var payload []artifactoryRepositoryResponse
	body, err := c.doRawJSON(ctx, http.MethodGet, "/artifactory/api/repositories?packageType=docker", nil, "application/json", http.StatusOK)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("failed to parse artifactory repositories: %w", err)
	}

	repositories := make([]ArtifactoryRepository, 0, len(payload))
	for _, entry := range payload {
		if !strings.EqualFold(strings.TrimSpace(entry.PackageType), "docker") {
			continue
		}
		key := strings.Trim(strings.TrimSpace(entry.Key), "/")
		if key == "" {
			continue
		}
		repositories = append(repositories, ArtifactoryRepository{
			Key:         key,
			PackageType: strings.TrimSpace(entry.PackageType),
			Class:       strings.TrimSpace(entry.Class),
			Description: strings.TrimSpace(entry.Description),
		})
	}

	return repositories, nil
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
	trimmedPaths := xrayExportPathCandidates(c.artifactoryID, candidatePaths...)
	if len(trimmedPaths) == 0 {
		trimmedPaths = append(trimmedPaths, "")
	}

	var lastErr error
	for _, candidatePath := range trimmedPaths {
		body := xrayComponentExportRequest{
			PackageType:       "docker",
			ComponentName:     componentName,
			Path:              candidatePath,
			OutputFormat:      "json",
			CycloneDX:         true,
			CycloneDXFormat:   "json",
			License:           true,
			LicenseResolution: true,
			Vulnerabilities:   true,
			Violations:        true,
			IncludeIgnored:    true,
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

func (c *xrayClient) exportIgnoredViolationRules(ctx context.Context, componentName string, candidatePaths ...string) ([]xrayExportIgnoreRule, error) {
	trimmedPaths := xrayExportPathCandidates(c.artifactoryID, candidatePaths...)
	if len(trimmedPaths) == 0 {
		trimmedPaths = append(trimmedPaths, "")
	}

	var lastErr error
	for _, candidatePath := range trimmedPaths {
		body := xrayComponentExportRequest{
			PackageType:    "docker",
			ComponentName:  componentName,
			Path:           candidatePath,
			OutputFormat:   "json_full",
			Violations:     true,
			IncludeIgnored: true,
		}

		payload, err := c.doRawJSON(ctx, http.MethodPost, "/xray/api/v2/component/exportDetails", body, "application/json, application/zip", http.StatusOK)
		if err != nil {
			lastErr = err
			continue
		}

		rules, err := parseXrayIgnoredViolationRulesFromExport(payload)
		if err != nil {
			lastErr = err
			continue
		}
		// A successful HTTP response with zero rules is valid (no ignored violations).
		// Return immediately so we don't fall through to try other paths and surface
		// a spurious error from a later candidate.
		return rules, nil
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, nil
}

func (c *xrayClient) exportViolations(ctx context.Context, componentName string, candidatePaths ...string) (*xrayViolationsResponse, error) {
	trimmedPaths := xrayExportPathCandidates(c.artifactoryID, candidatePaths...)
	if len(trimmedPaths) == 0 {
		trimmedPaths = append(trimmedPaths, "")
	}

	var lastErr error
	for _, candidatePath := range trimmedPaths {
		body := xrayComponentExportRequest{
			PackageType:    "docker",
			ComponentName:  componentName,
			Path:           candidatePath,
			OutputFormat:   "json_full",
			Violations:     true,
			IncludeIgnored: true,
		}

		payload, err := c.doRawJSON(ctx, http.MethodPost, "/xray/api/v2/component/exportDetails", body, "application/json, application/zip", http.StatusOK)
		if err != nil {
			lastErr = err
			continue
		}

		violations, err := parseXrayViolationsExport(payload)
		if err != nil {
			lastErr = err
			continue
		}
		if violations != nil && len(violations.Violations) > 0 {
			return violations, nil
		}
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, nil
}

func xrayExportPathCandidates(artifactoryID string, candidatePaths ...string) []string {
	results := make([]string, 0, len(candidatePaths)*2)
	seen := make(map[string]bool)
	trimmedArtifactoryID := strings.Trim(strings.TrimSpace(artifactoryID), "/")

	add := func(path string) {
		path = strings.Trim(strings.TrimSpace(path), "/")
		if path == "" || seen[path] {
			return
		}
		seen[path] = true
		results = append(results, path)
	}

	for _, candidate := range candidatePaths {
		path := strings.Trim(strings.TrimSpace(candidate), "/")
		if path == "" {
			continue
		}

		add(path)
		if trimmedArtifactoryID != "" {
			prefix := trimmedArtifactoryID + "/"
			if strings.HasPrefix(path, prefix) {
				add(strings.TrimPrefix(path, prefix))
			} else {
				add(prefix + path)
			}
		}
	}

	return results
}

func (c *xrayClient) warmImageInArtifactory(ctx context.Context, imageRepoPath, tag, platform string) error {
	waitWindow := registryWarmupWaitWindow()
	deadline := time.Now().Add(waitWindow)
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
			return fmt.Errorf("timed out after %s warming the artifactory cache: %w", waitWindow, lastErr)
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

// resolveManifestFilename returns "list.manifest.json" when the given
// reference resolves to a manifest list (multi-arch image) and
// "manifest.json" for single-platform images. Errors fall back to
// "manifest.json" so callers are not blocked on a non-fatal probe.
func (c *xrayClient) resolveManifestFilename(ctx context.Context, imageRepoPath, reference string) string {
	manifest, mediaType, _, err := c.fetchRegistryManifest(ctx, imageRepoPath, reference)
	if err != nil {
		return "manifest.json"
	}
	if isRegistryManifestIndex(mediaType, manifest) {
		return "list.manifest.json"
	}
	return "manifest.json"
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

func (c *xrayClient) pollArtifactSummary(ctx context.Context, candidates []xrayArtifactPathCandidate) (*xraySummaryResponse, xrayArtifactPathCandidate, error) {
	return c.pollArtifactSummaryWithin(ctx, candidates, xraySummaryWaitWindow())
}

func (c *xrayClient) pollArtifactSummaryWithin(ctx context.Context, candidates []xrayArtifactPathCandidate, waitWindow time.Duration) (*xraySummaryResponse, xrayArtifactPathCandidate, error) {
	candidates = dedupeXrayArtifactPathCandidates(candidates)
	if len(candidates) == 0 {
		return nil, xrayArtifactPathCandidate{}, fmt.Errorf("missing xray artifact summary path")
	}

	deadline := time.Now().Add(waitWindow)
	var missingArtifactSince time.Time
	var missingDetails []string
	for {
		allCandidatesMissing := true
		var availableSummary *xraySummaryResponse
		var availableCandidate xrayArtifactPathCandidate
		missingDetails = missingDetails[:0]
		for _, candidate := range candidates {
			summary, err := c.artifactSummary(ctx, candidate.ArtifactPath)
			if err == nil {
				if hasMissingXraySummaryError(summary) {
					missingDetails = append(missingDetails, fmt.Sprintf("%s: %s", candidate.ArtifactPath, formatXraySummaryErrors(summary.Errors)))
					continue
				}
				allCandidatesMissing = false
				if len(summary.Artifacts) > 0 {
					if xraySummaryIssueCount(summary) > 0 {
						return summary, candidate, nil
					}
					if availableSummary == nil {
						availableSummary = summary
						availableCandidate = candidate
					}
				}
				continue
			}

			if isRetriableXrayRequestError(err) {
				allCandidatesMissing = false
				continue
			}

			var httpErr *xrayHTTPError
			if !errors.As(err, &httpErr) || (httpErr.StatusCode != http.StatusNotFound && httpErr.StatusCode != http.StatusBadRequest) {
				return nil, xrayArtifactPathCandidate{}, err
			}

			detail := strings.TrimSpace(httpErr.Body)
			if detail == "" {
				detail = fmt.Sprintf("HTTP %d", httpErr.StatusCode)
			}
			missingDetails = append(missingDetails, fmt.Sprintf("%s: %s", candidate.ArtifactPath, detail))
		}

		if allCandidatesMissing {
			if missingArtifactSince.IsZero() {
				missingArtifactSince = time.Now()
			}
			if time.Since(missingArtifactSince) >= xrayMissingArtifactWindow {
				return nil, xrayArtifactPathCandidate{}, fmt.Errorf("xray did not expose artifact summary for any candidate path within %s; the image may not exist in Artifactory/Xray yet (%s)", xrayMissingArtifactWindow, strings.Join(missingDetails, "; "))
			}
		} else {
			missingArtifactSince = time.Time{}
			if availableSummary != nil {
				return availableSummary, availableCandidate, nil
			}
		}

		if time.Now().After(deadline) {
			return nil, xrayArtifactPathCandidate{}, fmt.Errorf("timed out after %s waiting for xray results for %s", waitWindow, joinXrayArtifactPaths(candidates))
		}

		select {
		case <-ctx.Done():
			return nil, xrayArtifactPathCandidate{}, ctx.Err()
		case <-time.After(xraySummaryPollInterval):
		}
	}
}

func xraySummaryIssueCount(summary *xraySummaryResponse) int {
	if summary == nil {
		return 0
	}

	total := 0
	for _, artifact := range summary.Artifacts {
		total += len(artifact.Issues)
	}
	return total
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

			if isRetriableXrayRequestError(err) {
				continue
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
	var requestPayload []byte
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal xray request: %w", err)
		}
		requestPayload = payload
		requestBody = bytes.NewReader(requestPayload)
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

	start := time.Now()
	resp, err := c.httpClient.Do(req)
	elapsed := time.Since(start)
	requestHeaders := sanitizeXrayHeaders(req.Header)
	requestBodyLog := truncateForXrayLog(string(requestPayload))
	if err != nil {
		c.logXRayRequest(
			ctx,
			method,
			path,
			req.URL.String(),
			0,
			elapsed,
			err,
			requestHeaders,
			requestBodyLog,
			nil,
			"",
		)
		return nil, fmt.Errorf("xray request failed: %w", err)
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read xray response: %w", err)
	}
	responseHeaders := sanitizeXrayHeaders(resp.Header)
	responseBodyLog := truncateForXrayLog(string(responseBody))

	for _, allowed := range allowedStatus {
		if resp.StatusCode == allowed {
			c.logXRayRequest(
				ctx,
				method,
				path,
				req.URL.String(),
				resp.StatusCode,
				elapsed,
				nil,
				requestHeaders,
				requestBodyLog,
				responseHeaders,
				responseBodyLog,
			)
			return responseBody, nil
		}
	}

	httpErr := &xrayHTTPError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(responseBody))}
	c.logXRayRequest(
		ctx,
		method,
		path,
		req.URL.String(),
		resp.StatusCode,
		elapsed,
		httpErr,
		requestHeaders,
		requestBodyLog,
		responseHeaders,
		responseBodyLog,
	)
	return nil, httpErr
}

// logXRayRequest persists a single xRay HTTP call to xray_request_logs. It is
// always fire-and-forget so it never blocks or fails the caller.
func (c *xrayClient) logXRayRequest(
	ctx context.Context,
	method,
	endpoint,
	requestURL string,
	statusCode int,
	duration time.Duration,
	callErr error,
	requestHeaders models.JSONObject,
	requestBody string,
	responseHeaders models.JSONObject,
	responseBody string,
) {
	if c.db == nil {
		return
	}

	durationMs := int(duration.Milliseconds())

	scanID := xrayScanIDFromContext(ctx)
	registryID := xrayRegistryIDFromContext(ctx)
	if registryID == nil {
		registryID = c.registryID
	}

	var errMsg *string
	if callErr != nil {
		s := callErr.Error()
		errMsg = &s
		if statusCode == 0 {
			statusCode = -1 // network error sentinel
		}
	}

	entry := &models.XRayRequestLog{
		ScanID:          scanID,
		RegistryID:      registryID,
		Method:          method,
		Endpoint:        endpoint,
		RequestURL:      requestURL,
		StatusCode:      statusCode,
		DurationMs:      durationMs,
		Error:           errMsg,
		RequestHeaders:  requestHeaders,
		RequestBody:     requestBody,
		ResponseHeaders: responseHeaders,
		ResponseBody:    responseBody,
	}

	db := c.db
	go func() {
		if _, err := db.NewInsert().Model(entry).Exec(context.Background()); err != nil {
			log.Debugf("xray_log: failed to record xray request: %v", err)
		}
	}()
}

func sanitizeXrayHeaders(headers http.Header) models.JSONObject {
	if len(headers) == 0 {
		return models.JSONObject{}
	}

	result := make(models.JSONObject, len(headers))
	for key, values := range headers {
		if len(values) == 0 {
			continue
		}
		lowerKey := strings.ToLower(strings.TrimSpace(key))
		if lowerKey == "authorization" || lowerKey == "x-jfrog-art-api" || lowerKey == "cookie" {
			result[key] = "[REDACTED]"
			continue
		}
		result[key] = strings.Join(values, ", ")
	}

	return result
}

func truncateForXrayLog(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if xrayRequestLogBodyLimit <= 0 {
		return raw
	}
	if len(raw) <= xrayRequestLogBodyLimit {
		return raw
	}
	return raw[:xrayRequestLogBodyLimit] + "\n...[truncated]"
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

	client := c.registryHTTPClient
	if client == nil {
		client = c.httpClient
	}
	if client == nil {
		client = &http.Client{Timeout: registryRequestTimeout}
	}

	resp, err := client.Do(req)
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

func (c *xrayClient) getIgnoreRules(ctx context.Context, vulnerabilityID string, artifactPaths []string, artifactName, artifactVersion string) ([]xrayIgnoreRule, error) {
	filterKey, filterValue, ok := xrayIgnoreRuleVulnerabilityFilter(vulnerabilityID)
	if !ok {
		return nil, nil
	}

	candidatePaths := make([]string, 0, len(artifactPaths))
	seenPaths := make(map[string]bool)
	for _, artifactPath := range artifactPaths {
		trimmed := strings.TrimSpace(artifactPath)
		if trimmed == "" || seenPaths[trimmed] {
			continue
		}
		seenPaths[trimmed] = true
		candidatePaths = append(candidatePaths, trimmed)
	}
	if len(candidatePaths) == 0 {
		candidatePaths = append(candidatePaths, "")
	}

	for _, artifactPath := range candidatePaths {
		params := url.Values{}
		params.Set(filterKey, filterValue)
		if artifactPath != "" {
			params.Set("artifact_path", artifactPath)
		}
		if trimmedName := strings.TrimSpace(artifactName); trimmedName != "" {
			params.Set("artifact_name", trimmedName)
		}
		if trimmedVersion := strings.TrimPrefix(strings.TrimSpace(artifactVersion), ":"); trimmedVersion != "" {
			params.Set("artifact_version", trimmedVersion)
		}
		params.Set("page_num", "1")
		params.Set("num_of_rows", "25")
		params.Set("order_by", "created")
		params.Set("direction", "desc")

		endpoint := "/xray/api/v1/ignore_rules?" + params.Encode()
		var raw any
		if _, err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &raw, http.StatusOK); err != nil {
			var httpErr *xrayHTTPError
			if errors.As(err, &httpErr) {
				switch httpErr.StatusCode {
				case http.StatusNotFound, http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusMethodNotAllowed:
					return nil, err
				}
			}
			return nil, err
		}

		rules := extractXrayIgnoreRules(raw)
		if len(rules) > 0 {
			return rules, nil
		}
	}

	return nil, nil
}

func xrayIgnoreRuleVulnerabilityFilter(vulnerabilityID string) (string, string, bool) {
	trimmed := strings.TrimSpace(vulnerabilityID)
	if trimmed == "" {
		return "", "", false
	}

	upper := strings.ToUpper(trimmed)
	if strings.HasPrefix(upper, "CVE-") {
		return "cve", trimmed, true
	}
	if strings.HasPrefix(upper, "XRAY-") {
		return "vulnerability", trimmed, true
	}

	return "", "", false
}

func persistXrayIgnoreRuleSnapshots(ctx context.Context, db *bun.DB, scan *models.Scan, client *xrayClient, exportComponentName string, artifactPaths ...string) error {
	if scan == nil || client == nil {
		return nil
	}

	var rows []struct {
		VulnID string `bun:"vuln_id"`
	}
	if err := db.NewSelect().Model((*models.Vulnerability)(nil)).
		ColumnExpr("DISTINCT vuln_id").
		Where("scan_id = ?", scan.ID).
		Scan(ctx, &rows); err != nil {
		return fmt.Errorf("failed to load vulnerabilities for xray suppression snapshot: %w", err)
	}

	artifactName := lastPathSegment(scan.ImageName)
	artifactVersion := strings.TrimPrefix(scan.ImageTag, ":")
	if strings.TrimSpace(exportComponentName) == "" {
		exportComponentName = xrayExportComponentName(scan.ImageName, scan.ImageTag, scan.ImageDigest)
	}
	results := make([]models.XraySuppression, 0, len(rows))
	successfulLookups := 0
	lookupErrors := 0
	var firstLookupErr error
	var exportFallback map[string]xrayIgnoreRule
	useExportFallback := false
	now := time.Now()

	for _, row := range rows {
		vulnID := strings.TrimSpace(row.VulnID)
		if vulnID == "" {
			continue
		}

		rules := []xrayIgnoreRule(nil)
		if useExportFallback {
			if fallbackRule, ok := exportFallback[vulnID]; ok {
				rules = []xrayIgnoreRule{fallbackRule}
				successfulLookups += 1
			} else {
				continue
			}
		} else {
			lookupRules, err := client.getIgnoreRules(ctx, vulnID, artifactPaths, artifactName, artifactVersion)
			if err != nil {
				if shouldTreatIgnoreRuleLookupAsUnavailable(err) {
					if exportFallback == nil {
						exportRules, exportErr := client.exportIgnoredViolationRules(ctx, exportComponentName, artifactPaths...)
						if exportErr != nil {
							recordScanStepOutput(ctx, db, scan.ID, describeNonFatalXrayIgnoreRuleSyncError(err))
							recordScanStepOutput(ctx, db, scan.ID, describeNonFatalXrayExportIgnoreRuleFallbackError(exportErr))
							return nil
						}
						exportFallback = map[string]xrayIgnoreRule{}
						for _, exportRule := range exportRules {
							if strings.TrimSpace(exportRule.VulnID) == "" {
								continue
							}
							if _, exists := exportFallback[exportRule.VulnID]; exists {
								continue
							}
							exportFallback[exportRule.VulnID] = exportRule.Rule
						}
						if len(exportFallback) > 0 {
							recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Xray ignore-rule API is unavailable; resolved %d suppressions from Export Component Details.", len(exportFallback)))
						}
					}
					useExportFallback = true
					if fallbackRule, ok := exportFallback[vulnID]; ok {
						rules = []xrayIgnoreRule{fallbackRule}
						successfulLookups += 1
					} else {
						continue
					}
				} else {
					lookupErrors += 1
					if firstLookupErr == nil {
						firstLookupErr = err
					}
					if successfulLookups == 0 && lookupErrors >= 5 {
						return fmt.Errorf("aborted xray ignore-rule sync after %d lookup failures: %w", lookupErrors, firstLookupErr)
					}
					continue
				}
			} else {
				rules = lookupRules
				successfulLookups += 1
			}
		}

		if len(rules) == 0 {
			continue
		}

		rule := rules[0]
		ruleID := strings.TrimSpace(rule.RuleID)
		if ruleID == "" {
			ruleID = fallbackXrayIgnoreRuleID(vulnID, rule.PolicyName, rule.WatchName)
		}

		results = append(results, models.XraySuppression{
			ScanID:        scan.ID,
			ImageDigest:   scan.ImageDigest,
			VulnID:        vulnID,
			RuleID:        ruleID,
			PolicyName:    strings.TrimSpace(rule.PolicyName),
			WatchName:     strings.TrimSpace(rule.WatchName),
			Justification: strings.TrimSpace(rule.Justification),
			ArtifactPath:  firstNonEmpty(artifactPaths...),
			ExpiresAt:     rule.ExpiresAt,
			Raw:           rule.Raw,
			CreatedAt:     now,
			UpdatedAt:     now,
		})
	}

	if successfulLookups == 0 && lookupErrors > 0 {
		return fmt.Errorf("failed to fetch xray ignore rules after %d lookup errors: %w", lookupErrors, firstLookupErr)
	}

	if _, err := db.NewDelete().Model((*models.XraySuppression)(nil)).Where("scan_id = ?", scan.ID).Exec(ctx); err != nil {
		return fmt.Errorf("failed to clear xray suppression snapshots: %w", err)
	}

	if len(results) == 0 {
		return nil
	}

	if _, err := db.NewInsert().Model(&results).Exec(ctx); err != nil {
		return fmt.Errorf("failed to persist xray suppression snapshots: %w", err)
	}

	recordScanStepOutput(ctx, db, scan.ID, fmt.Sprintf("Resolved %d Xray ignore-rule suppressions.", len(results)))
	return nil
}

func shouldTreatIgnoreRuleLookupAsUnavailable(err error) bool {
	var httpErr *xrayHTTPError
	if !errors.As(err, &httpErr) {
		return false
	}

	switch httpErr.StatusCode {
	case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusMethodNotAllowed:
		return true
	default:
		return false
	}
}

func describeNonFatalXrayIgnoreRuleSyncError(err error) string {
	var httpErr *xrayHTTPError
	if errors.As(err, &httpErr) {
		switch httpErr.StatusCode {
		case http.StatusBadRequest:
			return "Xray returned vulnerability results, but its optional ignore-rule lookup rejected the query parameters. Ignore-rule suppressions were skipped for this scan."
		case http.StatusUnauthorized, http.StatusForbidden:
			return "Xray returned vulnerability results, but the configured credentials do not have permission to read ignore rules. Ignore-rule suppressions were skipped for this scan."
		case http.StatusNotFound, http.StatusMethodNotAllowed:
			return "Xray returned vulnerability results, but this instance does not expose the ignore-rule lookup API. Ignore-rule suppressions were skipped for this scan."
		}
	}

	return fmt.Sprintf("Xray returned vulnerability results, but the optional ignore-rule lookup did not complete: %v", err)
}

func describeNonFatalXrayExportIgnoreRuleFallbackError(err error) string {
	var httpErr *xrayHTTPError
	if errors.As(err, &httpErr) {
		body := strings.ToLower(strings.TrimSpace(httpErr.Body))
		switch httpErr.StatusCode {
		case http.StatusBadRequest:
			if strings.Contains(body, "one parameter or more are missing") || strings.Contains(body, "non of the export options were selected") {
				return "Xray export fallback ran, but the endpoint rejected the report parameters. Ignore-rule suppressions were skipped for this scan."
			}
		case http.StatusUnauthorized, http.StatusForbidden:
			return "Xray export fallback ran, but the configured credentials do not have permission to export violation details. Ignore-rule suppressions were skipped for this scan."
		case http.StatusNotFound:
			return "Xray export fallback ran, but no export details were found for this artifact path. Ignore-rule suppressions were skipped for this scan."
		case http.StatusMethodNotAllowed:
			return "Xray export fallback ran, but this instance does not expose export details for violation reports. Ignore-rule suppressions were skipped for this scan."
		}
	}

	return fmt.Sprintf("Xray export fallback could not derive ignore-rule suppressions: %v", err)
}

func parseXrayIgnoredViolationRulesFromExport(payload []byte) ([]xrayExportIgnoreRule, error) {
	reader, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err == nil {
		results := make([]xrayExportIgnoreRule, 0)
		seen := make(map[string]bool)
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

			var raw any
			if err := json.Unmarshal(body, &raw); err != nil {
				continue
			}
			parsed := appendXrayIgnoredViolationRulesFromPayload(results, seen, raw)
			results = parsed
		}

		return results, nil
	}

	// Some Xray versions can return plain JSON directly for report exports.
	var raw any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse Xray export response as ZIP or JSON: %w", err)
	}
	results := make([]xrayExportIgnoreRule, 0)
	seen := make(map[string]bool)
	return appendXrayIgnoredViolationRulesFromPayload(results, seen, raw), nil
}

func appendXrayIgnoredViolationRulesFromPayload(results []xrayExportIgnoreRule, seen map[string]bool, payload any) []xrayExportIgnoreRule {
	candidates := collectXrayExportViolationCandidates(payload)
	for _, candidate := range candidates {
		vulnID := strings.TrimSpace(firstNonEmpty(
			findStringValue(candidate, "issue_id"),
			findStringValue(candidate, "vuln_id"),
			findStringValue(candidate, "vulnerability_id"),
			findStringValue(candidate, "cve"),
			findStringValue(candidate, "id"),
		))
		if vulnID == "" {
			continue
		}

		ignoredValue, ignoredPresent := findBoolValue(candidate, "ignored")
		if !ignoredPresent {
			ignoredValue, ignoredPresent = findBoolValue(candidate, "is_ignored")
		}
		if !ignoredPresent {
			ignoredText := strings.ToLower(strings.TrimSpace(firstNonEmpty(
				findStringValue(candidate, "status"),
				findStringValue(candidate, "violation_status"),
				findStringValue(candidate, "ignore_status"),
			)))
			if ignoredText == "ignored" || ignoredText == "ignore" || ignoredText == "suppressed" {
				ignoredValue = true
				ignoredPresent = true
			}
		}
		if !ignoredPresent || !ignoredValue {
			continue
		}

		rule := xrayIgnoreRule{
			RuleID: strings.TrimSpace(firstNonEmpty(
				findStringValue(candidate, "ignore_rule_id"),
				findStringValue(candidate, "rule_id"),
				findStringValue(candidate, "external_id"),
			)),
			PolicyName: strings.TrimSpace(firstNonEmpty(
				findStringValue(candidate, "policy"),
				findStringValue(candidate, "policy_name"),
			)),
			WatchName: strings.TrimSpace(firstNonEmpty(
				findStringValue(candidate, "watch"),
				findStringValue(candidate, "watch_name"),
			)),
			Justification: strings.TrimSpace(firstNonEmpty(
				findStringValue(candidate, "justification"),
				findStringValue(candidate, "ignore_reason"),
				findStringValue(candidate, "comment"),
			)),
			Raw: candidate,
		}

		rule.ExpiresAt = findTimeValue(candidate,
			"expires_at",
			"expired_at",
			"expires",
		)

		if rule.RuleID == "" {
			rule.RuleID = fallbackXrayIgnoreRuleID(vulnID, rule.PolicyName, rule.WatchName)
		}

		key := vulnID + "|" + rule.RuleID
		if seen[key] {
			continue
		}
		seen[key] = true
		results = append(results, xrayExportIgnoreRule{VulnID: vulnID, Rule: rule})
	}

	return results
}

func collectXrayExportViolationCandidates(payload any) []models.JSONObject {
	objects := collectXrayIgnoreRuleObjects(payload)
	results := make([]models.JSONObject, 0, len(objects))
	for _, object := range objects {
		hasIssue := hasMapKey(object, "issue_id") || hasMapKey(object, "vuln_id") || hasMapKey(object, "vulnerability_id") || hasMapKey(object, "cve")
		hasIgnoreSignal := hasMapKey(object, "is_ignored") || hasMapKey(object, "ignored") || hasMapKey(object, "ignore_rule_id") || hasMapKey(object, "justification") || hasMapKey(object, "policy") || hasMapKey(object, "policy_name") || hasMapKey(object, "watch") || hasMapKey(object, "watch_name")
		hasViolationContext := hasMapKey(object, "matched_policies") || hasMapKey(object, "watcher_name") || hasMapKey(object, "watch_name") || hasMapKey(object, "user_issue_id")
		if hasIssue && (hasIgnoreSignal || hasViolationContext) {
			results = append(results, object)
		}
	}
	return results
}

func hasMapKey(values models.JSONObject, key string) bool {
	if values == nil {
		return false
	}
	_, ok := values[key]
	if ok {
		return true
	}
	_, ok = values[strings.ToUpper(key)]
	if ok {
		return true
	}
	_, ok = values[strings.ToLower(key)]
	if ok {
		return true
	}
	return false
}

func findBoolValue(values models.JSONObject, key string) (bool, bool) {
	if values == nil {
		return false, false
	}
	raw, ok := values[key]
	if !ok {
		raw, ok = values[strings.ToUpper(key)]
	}
	if !ok {
		raw, ok = values[strings.ToLower(key)]
	}
	if !ok {
		return false, false
	}

	switch typed := raw.(type) {
	case bool:
		return typed, true
	case string:
		trimmed := strings.ToLower(strings.TrimSpace(typed))
		switch trimmed {
		case "true", "1", "yes", "y", "ignored", "suppressed":
			return true, true
		case "false", "0", "no", "n", "active", "open":
			return false, true
		}
	case float64:
		return typed != 0, true
	}

	return false, false
}

func parseXrayViolationsExport(payload []byte) (*xrayViolationsResponse, error) {
	reader, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err == nil {
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

			var raw any
			if err := json.Unmarshal(body, &raw); err != nil {
				continue
			}
			if parsed := parseXrayViolationsPayload(raw); parsed != nil {
				return parsed, nil
			}
		}
		return &xrayViolationsResponse{}, nil
	}

	var raw any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse Xray violations export response as ZIP or JSON: %w", err)
	}
	parsed := parseXrayViolationsPayload(raw)
	if parsed == nil {
		return &xrayViolationsResponse{}, nil
	}
	return parsed, nil
}

func parseXrayViolationsPayload(payload any) *xrayViolationsResponse {
	objects := collectXrayExportViolationCandidates(payload)
	if len(objects) == 0 {
		return nil
	}

	response := &xrayViolationsResponse{Violations: make([]xrayViolationRecord, 0, len(objects))}
	seen := make(map[string]bool)
	for _, object := range objects {
		issueID := strings.TrimSpace(firstNonEmpty(
			findStringValue(object, "issue_id"),
			findStringValue(object, "vuln_id"),
			findStringValue(object, "vulnerability_id"),
			findStringValue(object, "cve"),
		))
		if issueID == "" {
			continue
		}

		violationID := strings.TrimSpace(firstNonEmpty(
			findStringValue(object, "violation_id"),
			findStringValue(object, "user_issue_id"),
			findStringValue(object, "id"),
		))
		watchName := strings.TrimSpace(firstNonEmpty(
			findStringValue(object, "watch_name"),
			findStringValue(object, "watcher_name"),
		))
		watchID := strings.TrimSpace(firstNonEmpty(
			findStringValue(object, "watcher_id"),
			findStringValue(object, "watch_id"),
		))

		key := issueID + "|" + watchName + "|" + violationID
		if seen[key] {
			continue
		}
		seen[key] = true

		record := xrayViolationRecord{
			ID:            violationID,
			IssueID:       issueID,
			WatchID:       watchID,
			Watch:         watchName,
			Summary:       strings.TrimSpace(findStringValue(object, "summary")),
			Description:   strings.TrimSpace(findStringValue(object, "description")),
			Severity:      strings.TrimSpace(findStringValue(object, "severity")),
			Source:        strings.TrimSpace(findStringValue(object, "source")),
			SourceVersion: strings.TrimSpace(findStringValue(object, "source_version")),
			SourceID:      strings.TrimSpace(findStringValue(object, "source_id")),
			Raw:           object,
			Policies:      extractXrayViolationPolicies(object),
		}
		record.ImpactArtifacts = extractStringSlice(object, "paths")
		record.ComponentPhysicalPaths = extractStringSlice(object, "component_physical_paths")
		record.IsBlocking = anyXrayViolationPolicyBlocking(record.Policies)
		response.Violations = append(response.Violations, record)
	}

	response.Total = len(response.Violations)
	return response
}

func anyXrayViolationPolicyBlocking(policies []xrayViolationPolicy) bool {
	for _, policy := range policies {
		if policy.IsBlocking {
			return true
		}
	}
	return false
}

func extractXrayViolationPolicies(value any) []xrayViolationPolicy {
	objects := collectNestedObjectsByKey(value, "matched_policies")
	policies := make([]xrayViolationPolicy, 0, len(objects))
	for _, object := range objects {
		policy := xrayViolationPolicy{
			PolicyName:        strings.TrimSpace(findStringValue(object, "policy")),
			Rule:              strings.TrimSpace(findStringValue(object, "rule")),
			FailBuild:         findBoolValueLoose(object, "is_build_failed"),
			FailPullRequest:   findBoolValueLoose(object, "fail_pull_request"),
			SkipNotApplicable: findBoolValueLoose(object, "is_skip_not_applicable"),
			IsBlocking:        findBoolValueLoose(object, "is_blocking"),
		}
		if policy.PolicyName == "" && policy.Rule == "" {
			continue
		}
		policies = append(policies, policy)
	}
	return policies
}

func extractStringSlice(value any, key string) []string {
	objects := collectNestedValuesByKey(value, key)
	results := make([]string, 0)
	seen := make(map[string]bool)
	for _, object := range objects {
		slice, ok := object.([]any)
		if !ok {
			continue
		}
		for _, item := range slice {
			text := strings.TrimSpace(fmt.Sprint(item))
			if text == "" || text == "<nil>" || seen[text] {
				continue
			}
			seen[text] = true
			results = append(results, text)
		}
	}
	return results
}

func collectNestedObjectsByKey(value any, key string) []models.JSONObject {
	results := make([]models.JSONObject, 0)
	for _, raw := range collectNestedValuesByKey(value, key) {
		slice, ok := raw.([]any)
		if !ok {
			continue
		}
		for _, item := range slice {
			switch typed := item.(type) {
			case map[string]any:
				results = append(results, toJSONObject(typed))
			case models.JSONObject:
				results = append(results, typed)
			}
		}
	}
	return results
}

func collectNestedValuesByKey(value any, key string) []any {
	results := make([]any, 0)
	var walk func(any)
	walk = func(current any) {
		switch typed := current.(type) {
		case models.JSONObject:
			for k, item := range typed {
				if strings.EqualFold(strings.TrimSpace(k), key) {
					results = append(results, item)
				}
				walk(item)
			}
		case map[string]any:
			for k, item := range typed {
				if strings.EqualFold(strings.TrimSpace(k), key) {
					results = append(results, item)
				}
				walk(item)
			}
		case []any:
			for _, item := range typed {
				walk(item)
			}
		}
	}
	walk(value)
	return results
}

func findBoolValueLoose(values models.JSONObject, key string) bool {
	value, ok := findBoolValue(values, key)
	return ok && value
}

func extractXrayIgnoreRules(payload any) []xrayIgnoreRule {
	objects := collectXrayIgnoreRuleObjects(payload)
	results := make([]xrayIgnoreRule, 0, len(objects))
	for _, object := range objects {
		ruleID := firstNonEmpty(
			findStringValue(object, "external_id"),
			findStringValue(object, "rule_id"),
			findStringValue(object, "id"),
		)
		policyName := firstNonEmpty(
			findStringValue(object, "policy_name"),
			findStringValue(object, "policy"),
		)
		watchName := firstNonEmpty(
			findStringValue(object, "watch_name"),
			findStringValue(object, "watch"),
		)
		justification := firstNonEmpty(
			findStringValue(object, "notes"),
			findStringValue(object, "note"),
			findStringValue(object, "reason"),
			findStringValue(object, "description"),
			findStringValue(object, "summary"),
		)
		if ruleID == "" && policyName == "" && watchName == "" && justification == "" {
			continue
		}
		results = append(results, xrayIgnoreRule{
			RuleID:        ruleID,
			PolicyName:    policyName,
			WatchName:     watchName,
			Justification: justification,
			ExpiresAt:     findTimeValue(object, "expires_at", "expiresAt", "expiration_date", "expiry_date"),
			Raw:           object,
		})
	}
	return results
}

func collectXrayIgnoreRuleObjects(payload any) []models.JSONObject {
	switch typed := payload.(type) {
	case []any:
		results := make([]models.JSONObject, 0, len(typed))
		for _, item := range typed {
			results = append(results, collectXrayIgnoreRuleObjects(item)...)
		}
		return results
	case map[string]any:
		object := toJSONObject(typed)
		for _, key := range []string{"ignore_rules", "data", "results", "items", "rules", "violations"} {
			if nested, ok := typed[key]; ok {
				results := collectXrayIgnoreRuleObjects(nested)
				if len(results) > 0 {
					return results
				}
			}
		}
		return []models.JSONObject{object}
	default:
		return nil
	}
}

func toJSONObject(value map[string]any) models.JSONObject {
	result := make(models.JSONObject, len(value))
	for key, item := range value {
		result[key] = item
	}
	return result
}

func findStringValue(value any, targetKey string) string {
	switch typed := value.(type) {
	case models.JSONObject:
		for key, item := range typed {
			if strings.EqualFold(strings.TrimSpace(key), targetKey) {
				if text := strings.TrimSpace(fmt.Sprint(item)); text != "" && text != "<nil>" {
					return text
				}
			}
			if nested := findStringValue(item, targetKey); nested != "" {
				return nested
			}
		}
	case map[string]any:
		for key, item := range typed {
			if strings.EqualFold(strings.TrimSpace(key), targetKey) {
				if text := strings.TrimSpace(fmt.Sprint(item)); text != "" && text != "<nil>" {
					return text
				}
			}
			if nested := findStringValue(item, targetKey); nested != "" {
				return nested
			}
		}
	case []any:
		for _, item := range typed {
			if nested := findStringValue(item, targetKey); nested != "" {
				return nested
			}
		}
	}
	return ""
}

func findTimeValue(value any, keys ...string) *time.Time {
	for _, key := range keys {
		if raw := findStringValue(value, key); raw != "" {
			for _, layout := range []string{time.RFC3339, time.RFC3339Nano, "2006-01-02T15:04:05.000Z07:00", "2006-01-02 15:04:05"} {
				parsed, err := time.Parse(layout, raw)
				if err == nil {
					return &parsed
				}
			}
		}
	}
	return nil
}

func fallbackXrayIgnoreRuleID(vulnID, policyName, watchName string) string {
	parts := []string{strings.TrimSpace(vulnID), strings.TrimSpace(policyName), strings.TrimSpace(watchName)}
	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			filtered = append(filtered, part)
		}
	}
	if len(filtered) == 0 {
		return "xray-ignore"
	}
	return strings.Join(filtered, ":")
}

func lastPathSegment(value string) string {
	trimmed := strings.Trim(strings.TrimSpace(value), "/")
	if trimmed == "" {
		return ""
	}
	if idx := strings.LastIndex(trimmed, "/"); idx >= 0 {
		return trimmed[idx+1:]
	}
	return trimmed
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

func buildXrayArtifactPathCandidates(artifactoryID, repository, artifactName, reference, manifestFilename, resolvedDigest string) []xrayArtifactPathCandidate {
	results := make([]xrayArtifactPathCandidate, 0, 4)
	addCandidate := func(repo, path, filename string) {
		path = strings.Trim(strings.TrimSpace(path), "/")
		filename = strings.TrimSpace(filename)
		repo = strings.Trim(strings.TrimSpace(repo), "/")
		if repo == "" || path == "" || filename == "" {
			return
		}
		candidate := xrayArtifactPathCandidate{
			Repository: repo,
			Path:       path + "/" + filename,
		}
		candidate.RepoPath = repo + "/" + candidate.Path
		candidate.ArtifactPath = strings.Trim(strings.TrimSpace(artifactoryID), "/")
		if candidate.ArtifactPath != "" {
			candidate.ArtifactPath += "/"
		}
		candidate.ArtifactPath += candidate.RepoPath
		results = append(results, candidate)
	}

	repositories := xrayRepositoryCandidates(repository)
	artifactPath := strings.Trim(artifactName, "/") + "/" + strings.TrimPrefix(strings.TrimSpace(reference), ":")
	digestReference := xrayDigestArtifactReference(resolvedDigest)
	for _, repo := range repositories {
		addCandidate(repo, artifactPath, manifestFilename)
		if digestReference != "" {
			addCandidate(repo, strings.Trim(artifactName, "/")+"/"+digestReference, "manifest.json")
		}
	}

	return dedupeXrayArtifactPathCandidates(results)
}

func xrayRepositoryCandidates(repository string) []string {
	repository = strings.Trim(strings.TrimSpace(repository), "/")
	if repository == "" {
		return nil
	}

	results := []string{repository}
	if !strings.HasSuffix(repository, "-cache") {
		results = append(results, repository+"-cache")
	}
	return results
}

func xrayDigestArtifactReference(digest string) string {
	trimmed := strings.TrimSpace(digest)
	if trimmed == "" {
		return ""
	}
	parts := strings.SplitN(trimmed, ":", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return ""
	}
	return strings.TrimSpace(parts[0]) + "__" + strings.TrimSpace(parts[1])
}

func xrayExportComponentName(imageName, imageTag, imageDigest string) string {
	if digestRef := xrayDigestArtifactReference(imageDigest); digestRef != "" {
		return buildImageRef(imageName, digestRef)
	}
	return buildImageRef(imageName, imageTag)
}

// xraySummaryExportDetails extracts the canonical component name and export path
// from the first artifact in a summary/artifact response. The returned exportPath
// does NOT include the artifactoryID prefix and ends with "/manifest.json" so it
// matches what the Xray exportDetails endpoint expects.
func xraySummaryExportDetails(summary *xraySummaryResponse, artifactoryID string) (componentName, exportPath string) {
	if summary == nil || len(summary.Artifacts) == 0 {
		return "", ""
	}
	artifact := summary.Artifacts[0]
	componentName = strings.TrimSpace(artifact.General.Name)
	rawPath := strings.TrimRight(strings.TrimSpace(artifact.General.Path), "/")
	if rawPath == "" {
		return componentName, ""
	}
	prefix := strings.TrimRight(strings.TrimSpace(artifactoryID), "/")
	if prefix != "" {
		rawPath = strings.TrimPrefix(rawPath, prefix+"/")
	}
	exportPath = rawPath + "/manifest.json"
	return
}

func dedupeXrayArtifactPathCandidates(candidates []xrayArtifactPathCandidate) []xrayArtifactPathCandidate {
	results := make([]xrayArtifactPathCandidate, 0, len(candidates))
	seen := make(map[string]bool)
	for _, candidate := range candidates {
		artifactPath := strings.TrimSpace(candidate.ArtifactPath)
		if artifactPath == "" || seen[artifactPath] {
			continue
		}
		seen[artifactPath] = true
		results = append(results, candidate)
	}
	return results
}

func preferredXrayArtifactCandidate(candidates []xrayArtifactPathCandidate) xrayArtifactPathCandidate {
	if len(candidates) == 0 {
		return xrayArtifactPathCandidate{}
	}

	best := candidates[0]
	bestScore := scoreXrayArtifactCandidate(best)
	for _, candidate := range candidates[1:] {
		score := scoreXrayArtifactCandidate(candidate)
		if score > bestScore {
			best = candidate
			bestScore = score
		}
	}

	return best
}

func scoreXrayArtifactCandidate(candidate xrayArtifactPathCandidate) int {
	path := strings.ToLower(strings.TrimSpace(candidate.Path))
	repo := strings.ToLower(strings.TrimSpace(candidate.Repository))
	score := 0

	if strings.Contains(path, "sha256__") {
		score += 6
	}
	if strings.HasSuffix(repo, "-cache") {
		score += 4
	}
	if strings.HasSuffix(path, "/manifest.json") {
		score += 3
	}
	if strings.Contains(path, "list.manifest.json") {
		score -= 2
	}

	return score
}

func joinXrayArtifactPaths(candidates []xrayArtifactPathCandidate) string {
	paths := make([]string, 0, len(candidates))
	for _, candidate := range dedupeXrayArtifactPathCandidates(candidates) {
		if artifactPath := strings.TrimSpace(candidate.ArtifactPath); artifactPath != "" {
			paths = append(paths, artifactPath)
		}
	}
	return strings.Join(paths, ", ")
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

	candidates := buildXrayArtifactPathCandidates(artifactoryID, repo, artifactName, tag, "manifest.json", "")
	if len(candidates) == 0 {
		return "", "", fmt.Errorf("failed to build xray artifact path for %s:%s", imageName, imageTag)
	}
	return candidates[0].RepoPath, candidates[0].ArtifactPath, nil
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

func persistXrayViolationContext(ctx context.Context, db *bun.DB, scan *models.Scan, response *xrayViolationsResponse) error {
	if scan == nil || response == nil || len(response.Violations) == 0 {
		return nil
	}

	type contextRecord struct {
		IssueID                string
		ViolationID            string
		WatchName              string
		WatchNames             []string
		WatchPolicyMatches     []models.JSONObject
		MatchedPolicies        []models.JSONObject
		ViolationPaths         []string
		ComponentPhysicalPaths []string
		Source                 string
		SourceVersion          string
		SourceID               string
		IsBlocking             bool
		Raw                    models.JSONObject
	}

	byVulnID := make(map[string]*contextRecord)
	for _, violation := range response.Violations {
		candidateVulnIDs := xrayViolationCandidateVulnIDs(violation)
		if len(candidateVulnIDs) == 0 {
			continue
		}

		firstKey := candidateVulnIDs[0]
		record, exists := byVulnID[firstKey]
		if !exists {
			record = &contextRecord{}
			byVulnID[firstKey] = record
		}
		for _, vulnID := range candidateVulnIDs[1:] {
			if _, ok := byVulnID[vulnID]; !ok {
				byVulnID[vulnID] = record
			}
		}

		if record.ViolationID == "" {
			record.ViolationID = strings.TrimSpace(violation.ID)
		}
		if record.IssueID == "" {
			record.IssueID = strings.TrimSpace(violation.IssueID)
		}
		if record.WatchName == "" {
			record.WatchName = strings.TrimSpace(violation.Watch)
		}
		record.WatchNames = append(record.WatchNames, strings.TrimSpace(violation.Watch))
		if record.Source == "" {
			record.Source = strings.TrimSpace(violation.Source)
		}
		if record.SourceVersion == "" {
			record.SourceVersion = strings.TrimSpace(violation.SourceVersion)
		}
		if record.SourceID == "" {
			record.SourceID = strings.TrimSpace(violation.SourceID)
		}
		if len(record.Raw) == 0 && len(violation.Raw) > 0 {
			record.Raw = violation.Raw
		}
		record.IsBlocking = record.IsBlocking || violation.IsBlocking

		record.MatchedPolicies = append(record.MatchedPolicies, xrayViolationPoliciesToJSON(violation.Policies)...)
		record.WatchPolicyMatches = append(record.WatchPolicyMatches, xrayWatchPolicyMatchesToJSON(violation)...)
		record.ViolationPaths = append(record.ViolationPaths, violation.ImpactArtifacts...)
		record.ComponentPhysicalPaths = append(record.ComponentPhysicalPaths, violation.ComponentPhysicalPaths...)
	}

	for vulnID, record := range byVulnID {
		watchNames := dedupeStrings(record.WatchNames)
		watchName := strings.TrimSpace(record.WatchName)
		if watchName == "" && len(watchNames) > 0 {
			watchName = watchNames[0]
		}
		if _, err := db.NewUpdate().Model((*models.Vulnerability)(nil)).
			Set("xray_issue_id = ?", strings.TrimSpace(record.IssueID)).
			Set("xray_violation_id = ?", strings.TrimSpace(record.ViolationID)).
			Set("xray_watch_name = ?", watchName).
			Set("xray_watch_names = ?", watchNames).
			Set("xray_watch_policy_matches = ?", dedupeJSONObjects(record.WatchPolicyMatches)).
			Set("xray_matched_policies = ?", dedupeJSONObjects(record.MatchedPolicies)).
			Set("xray_violation_paths = ?", dedupeStrings(record.ViolationPaths)).
			Set("xray_component_physical_paths = ?", dedupeStrings(record.ComponentPhysicalPaths)).
			Set("xray_source = ?", strings.TrimSpace(record.Source)).
			Set("xray_source_version = ?", strings.TrimSpace(record.SourceVersion)).
			Set("xray_source_id = ?", strings.TrimSpace(record.SourceID)).
			Set("xray_is_blocking = ?", record.IsBlocking).
			Set("xray_violation_raw = ?", record.Raw).
			Where("scan_id = ?", scan.ID).
			Where("(vuln_id = ? OR xray_issue_id = ?)", vulnID, vulnID).
			Exec(ctx); err != nil {
			return fmt.Errorf("failed to persist xray violation context for %s: %w", vulnID, err)
		}
	}

	return nil
}

func xrayViolationCandidateVulnIDs(violation xrayViolationRecord) []string {
	results := make([]string, 0, 4)
	seen := make(map[string]bool)
	add := func(value string) {
		value = strings.TrimSpace(strings.ToUpper(value))
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		results = append(results, value)
	}

	add(violation.IssueID)
	add(violation.ID)

	if rawCVEs, ok := violation.Raw["cves"]; ok {
		if entries, ok := rawCVEs.([]any); ok {
			for _, entry := range entries {
				switch typed := entry.(type) {
				case map[string]any:
					add(fmt.Sprint(typed["cve"]))
				case models.JSONObject:
					add(fmt.Sprint(typed["cve"]))
				}
			}
		}
	}

	return results
}

func dedupeStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	results := make([]string, 0, len(values))
	seen := make(map[string]bool)
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		results = append(results, value)
	}
	return results
}

func dedupeJSONObjects(values []models.JSONObject) []models.JSONObject {
	if len(values) == 0 {
		return []models.JSONObject{}
	}
	results := make([]models.JSONObject, 0, len(values))
	seen := make(map[string]bool)
	for _, value := range values {
		if value == nil {
			continue
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			continue
		}
		key := string(encoded)
		if seen[key] {
			continue
		}
		seen[key] = true
		results = append(results, value)
	}
	return results
}

func persistXrayCycloneDXFallback(ctx context.Context, db *bun.DB, scan *models.Scan, client *xrayClient, exportComponentName, artifactPath, repoPath string) (int, error) {
	if scan == nil || client == nil {
		return 0, nil
	}
	if strings.TrimSpace(exportComponentName) == "" {
		exportComponentName = xrayExportComponentName(scan.ImageName, scan.ImageTag, scan.ImageDigest)
	}

	sbom, exportPath, err := client.exportComponentCycloneDX(ctx, exportComponentName, artifactPath, repoPath)
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

func persistXraySBOMComponents(ctx context.Context, db *bun.DB, scan *models.Scan, client *xrayClient, exportComponentName, artifactPath, repoPath string) error {
	if scan == nil || client == nil {
		return nil
	}
	if strings.TrimSpace(exportComponentName) == "" {
		exportComponentName = xrayExportComponentName(scan.ImageName, scan.ImageTag, scan.ImageDigest)
	}

	sbom, exportPath, err := client.exportComponentCycloneDX(ctx, exportComponentName, artifactPath, repoPath)
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
					XrayIssueID:         strings.TrimSpace(issue.IssueID),
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
			ScanID:                     scanID,
			VulnID:                     vulnID,
			PkgName:                    pkgName,
			InstalledVersion:           strings.TrimSpace(fallbackVersion),
			Severity:                   normalizeXraySeverity(violation.Severity),
			Title:                      strings.TrimSpace(violation.Summary),
			Description:                strings.TrimSpace(violation.Description),
			References:                 nil,
			DataSource:                 xrayDataSource,
			XrayIssueID:                strings.TrimSpace(violation.IssueID),
			XrayViolationID:            strings.TrimSpace(violation.ID),
			XrayWatchName:              strings.TrimSpace(violation.Watch),
			XrayWatchNames:             dedupeStrings([]string{strings.TrimSpace(violation.Watch)}),
			XrayWatchPolicyMatches:     xrayWatchPolicyMatchesToJSON(violation),
			XrayMatchedPolicies:        xrayViolationPoliciesToJSON(violation.Policies),
			XrayViolationPaths:         append([]string(nil), violation.ImpactArtifacts...),
			XrayComponentPhysicalPaths: append([]string(nil), violation.ComponentPhysicalPaths...),
			XraySource:                 strings.TrimSpace(violation.Source),
			XraySourceVersion:          strings.TrimSpace(violation.SourceVersion),
			XraySourceID:               strings.TrimSpace(violation.SourceID),
			XrayIsBlocking:             violation.IsBlocking,
			XrayViolationRaw:           violation.Raw,
		})
	}

	return vulns
}

func xrayViolationPoliciesToJSON(policies []xrayViolationPolicy) []models.JSONObject {
	if len(policies) == 0 {
		return []models.JSONObject{}
	}
	results := make([]models.JSONObject, 0, len(policies))
	for _, policy := range policies {
		results = append(results, models.JSONObject{
			"policy":                 strings.TrimSpace(policy.PolicyName),
			"rule":                   strings.TrimSpace(policy.Rule),
			"is_build_failed":        policy.FailBuild,
			"fail_pull_request":      policy.FailPullRequest,
			"is_skip_not_applicable": policy.SkipNotApplicable,
			"is_blocking":            policy.IsBlocking,
		})
	}
	return results
}

func xrayWatchPolicyMatchesToJSON(violation xrayViolationRecord) []models.JSONObject {
	if len(violation.Policies) == 0 {
		return []models.JSONObject{}
	}

	watchName := strings.TrimSpace(violation.Watch)
	watchID := strings.TrimSpace(violation.WatchID)
	results := make([]models.JSONObject, 0, len(violation.Policies))
	for _, policy := range violation.Policies {
		results = append(results, models.JSONObject{
			"watch_name":             watchName,
			"watch_id":               watchID,
			"policy":                 strings.TrimSpace(policy.PolicyName),
			"rule":                   strings.TrimSpace(policy.Rule),
			"is_build_failed":        policy.FailBuild,
			"fail_pull_request":      policy.FailPullRequest,
			"is_skip_not_applicable": policy.SkipNotApplicable,
			"is_blocking":            policy.IsBlocking,
		})
	}

	return results
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
	if isRetriableXrayRequestError(err) {
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

func isRetriableXrayRequestError(err error) bool {
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

	switch httpErr.StatusCode {
	case http.StatusRequestTimeout, http.StatusTooManyRequests, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

func describeNonFatalXrayIndexError(repoPath string, err error) string {
	var httpErr *xrayHTTPError
	if errors.As(err, &httpErr) {
		switch httpErr.StatusCode {
		case http.StatusForbidden, http.StatusUnauthorized:
			return fmt.Sprintf("Xray skipped the optional index request for %s because the configured credentials do not have re-index permissions. Continuing with the existing artifact state.", repoPath)
		case http.StatusConflict:
			return fmt.Sprintf("Xray reported that %s is already being indexed. Continuing to wait for the artifact summary.", repoPath)
		}
	}

	return fmt.Sprintf("Xray index request returned a non-fatal response for %s. Continuing anyway: %v", repoPath, err)
}

func describeNonFatalXrayScanArtifactError(componentID string, err error) string {
	var httpErr *xrayHTTPError
	if errors.As(err, &httpErr) {
		body := strings.ToLower(strings.TrimSpace(httpErr.Body))
		if httpErr.StatusCode == http.StatusInternalServerError && strings.Contains(body, "failed to scan component") {
			return fmt.Sprintf("Xray did not accept the explicit scanArtifact request for %s, but the artifact summary endpoint can still return results. Continuing to poll Xray.", componentID)
		}
		if httpErr.StatusCode == http.StatusConflict {
			return fmt.Sprintf("Xray reported that %s is already queued or scanning. Continuing to poll the artifact summary.", componentID)
		}
	}

	return fmt.Sprintf("Xray scanArtifact returned a non-fatal response for %s. Continuing to poll the artifact summary: %v", componentID, err)
}

func describeNonFatalXraySBOMImportError(err error) string {
	var httpErr *xrayHTTPError
	if errors.As(err, &httpErr) {
		body := strings.ToLower(strings.TrimSpace(httpErr.Body))
		switch httpErr.StatusCode {
		case http.StatusBadRequest:
			if strings.Contains(body, "one parameter or more are missing") {
				return "Xray returned vulnerability results, but its optional component export endpoint rejected the SBOM request. Vulnerability findings were imported; SBOM components were skipped."
			}
		case http.StatusForbidden, http.StatusUnauthorized:
			return "Xray returned vulnerability results, but the configured credentials do not have permission to export SBOM component details. Vulnerability findings were imported; SBOM components were skipped."
		case http.StatusNotFound:
			return "Xray returned vulnerability results, but it did not expose a component export for this artifact. Vulnerability findings were imported; SBOM components were skipped."
		}
	}

	return fmt.Sprintf("Xray returned vulnerability results, but the optional SBOM component import did not complete: %v", err)
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
	// Unexpected EOF during blob streaming is a transient connection drop.
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}

	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}

	normalizedErr := strings.ToLower(err.Error())
	if strings.Contains(normalizedErr, "client.timeout exceeded") ||
		strings.Contains(normalizedErr, "context deadline exceeded") ||
		strings.Contains(normalizedErr, "unexpected eof") ||
		strings.Contains(normalizedErr, "connection reset by peer") ||
		strings.Contains(normalizedErr, "connection refused") {
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
