package scanner

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

const osvQueryURL = "https://api.osv.dev/v1/query"

type osvQueryRequest struct {
	Version string          `json:"version,omitempty"`
	Package osvPackageQuery `json:"package"`
}

type osvPackageQuery struct {
	Name      string `json:"name,omitempty"`
	Ecosystem string `json:"ecosystem,omitempty"`
}

type osvQueryResponse struct {
	Vulns []osvVuln `json:"vulns"`
}

type osvVuln struct {
	ID               string            `json:"id"`
	Summary          string            `json:"summary"`
	Details          string            `json:"details"`
	Aliases          []string          `json:"aliases"`
	Modified         string            `json:"modified"`
	Published        string            `json:"published"`
	DatabaseSpecific osvDatabaseInfo   `json:"database_specific"`
	References       []osvReference    `json:"references"`
	Affected         []osvAffectedItem `json:"affected"`
}

type osvDatabaseInfo struct {
	Severity string `json:"severity"`
	Source   string `json:"source"`
}

type osvReference struct {
	URL  string `json:"url"`
	Type string `json:"type"`
}

type osvAffectedItem struct {
	Package           osvAffectedPackage `json:"package"`
	Ranges            []osvAffectedRange `json:"ranges"`
	EcosystemSpecific osvDatabaseInfo    `json:"ecosystem_specific"`
}

type osvAffectedPackage struct {
	Name      string `json:"name"`
	Ecosystem string `json:"ecosystem"`
	PURL      string `json:"purl"`
}

type osvAffectedRange struct {
	Type   string             `json:"type"`
	Events []osvAffectedEvent `json:"events"`
}

type osvAffectedEvent struct {
	Introduced string `json:"introduced,omitempty"`
	Fixed      string `json:"fixed,omitempty"`
}

type osvPackageKey struct {
	Ecosystem string
	Name      string
	Version   string
	PkgName   string
}

func AugmentJavaVulnerabilitiesFromOSV(ctx context.Context, db *bun.DB, scanID uuid.UUID, components []models.SBOMComponent, existing []models.Vulnerability) []models.Vulnerability {
	if !config.Config.Scanner.EnableOSVJavaAugmentation {
		return nil
	}

	packages := uniqueOSVPackageKeys(components)
	if len(packages) == 0 {
		return nil
	}

	cacheTTL := time.Duration(config.Config.VulnKB.CacheDays) * 24 * time.Hour
	if cacheTTL <= 0 {
		cacheTTL = 7 * 24 * time.Hour
	}

	client := &http.Client{Timeout: 15 * time.Second}
	existingKeys := make(map[string]struct{}, len(existing))
	for _, vuln := range existing {
		existingKeys[vuln.VulnID+"|"+vuln.PkgName] = struct{}{}
	}

	var supplemental []models.Vulnerability
	for _, pkg := range packages {
		findings, err := loadOSVFindingsForPackage(ctx, db, client, pkg, cacheTTL)
		if err != nil {
			log.Warnf("Worker: OSV lookup failed for %s@%s (non-fatal): %v", pkg.Name, pkg.Version, err)
			continue
		}
		for _, finding := range findings {
			key := finding.VulnID + "|" + pkg.PkgName
			if _, exists := existingKeys[key]; exists {
				continue
			}
			existingKeys[key] = struct{}{}
			references := make([]string, 0, len(finding.References))
			for _, ref := range finding.References {
				if ref.URL != "" {
					references = append(references, ref.URL)
				}
			}
			supplemental = append(supplemental, models.Vulnerability{
				ScanID:           scanID,
				VulnID:           finding.VulnID,
				PkgName:          pkg.PkgName,
				InstalledVersion: pkg.Version,
				FixedVersion:     finding.FixedVersion,
				Severity:         normalizeSeverity(finding.Severity),
				Title:            finding.Summary,
				Description:      finding.Details,
				References:       references,
				DataSource:       "osv.dev",
			})
		}
	}

	return supplemental
}

func uniqueOSVPackageKeys(components []models.SBOMComponent) []osvPackageKey {
	seen := map[string]struct{}{}
	keys := make([]osvPackageKey, 0)
	for _, component := range components {
		pkg, ok := parseMavenPackageKey(component)
		if !ok {
			continue
		}
		dedupeKey := pkg.Ecosystem + "|" + pkg.Name + "|" + pkg.Version
		if _, exists := seen[dedupeKey]; exists {
			continue
		}
		seen[dedupeKey] = struct{}{}
		keys = append(keys, pkg)
	}
	return keys
}

func parseMavenPackageKey(component models.SBOMComponent) (osvPackageKey, bool) {
	purl := strings.TrimSpace(component.PackageURL)
	if !strings.HasPrefix(purl, "pkg:maven/") {
		return osvPackageKey{}, false
	}
	remainder := strings.TrimPrefix(purl, "pkg:maven/")
	namePart, version, ok := strings.Cut(remainder, "@")
	if !ok || version == "" {
		return osvPackageKey{}, false
	}
	sep := strings.LastIndex(namePart, "/")
	if sep <= 0 || sep == len(namePart)-1 {
		return osvPackageKey{}, false
	}
	group := namePart[:sep]
	artifact := namePart[sep+1:]
	return osvPackageKey{
		Ecosystem: "Maven",
		Name:      group + ":" + artifact,
		Version:   version,
		PkgName:   group + ":" + artifact,
	}, true
}

func loadOSVFindingsForPackage(ctx context.Context, db *bun.DB, client *http.Client, pkg osvPackageKey, cacheTTL time.Duration) ([]models.OSVPackageFinding, error) {
	cache := &models.OSVPackageCache{}
	err := db.NewSelect().Model(cache).
		Where("ecosystem = ? AND name = ? AND version = ?", pkg.Ecosystem, pkg.Name, pkg.Version).
		Scan(ctx)
	if err == nil && time.Since(cache.FetchedAt) < cacheTTL {
		return cache.Findings, nil
	}
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}

	findings, fetchErr := queryOSVPackage(ctx, client, pkg)
	if fetchErr != nil {
		if err == nil && len(cache.Findings) > 0 {
			return cache.Findings, nil
		}
		return nil, fetchErr
	}

	entry := &models.OSVPackageCache{
		Ecosystem: pkg.Ecosystem,
		Name:      pkg.Name,
		Version:   pkg.Version,
		Findings:  findings,
		FetchedAt: time.Now(),
	}
	if _, err := db.NewInsert().Model(entry).
		On("CONFLICT (ecosystem, name, version) DO UPDATE").
		Set("findings = EXCLUDED.findings").
		Set("fetched_at = EXCLUDED.fetched_at").
		Exec(ctx); err != nil {
		log.Warnf("Worker: failed to cache OSV findings for %s@%s: %v", pkg.Name, pkg.Version, err)
	}

	return findings, nil
}

func queryOSVPackage(ctx context.Context, client *http.Client, pkg osvPackageKey) ([]models.OSVPackageFinding, error) {
	payload, err := json.Marshal(osvQueryRequest{
		Version: pkg.Version,
		Package: osvPackageQuery{Name: pkg.Name, Ecosystem: pkg.Ecosystem},
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, osvQueryURL, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "JustScan/OSV-Augmentation")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("OSV query returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}

	var result osvQueryResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	findings := make([]models.OSVPackageFinding, 0, len(result.Vulns))
	for _, vuln := range result.Vulns {
		refs := make([]models.KBRef, 0, len(vuln.References))
		for _, ref := range vuln.References {
			refs = append(refs, models.KBRef{URL: ref.URL, Source: ref.Type})
		}
		findings = append(findings, models.OSVPackageFinding{
			VulnID:       osvPreferredID(vuln),
			Aliases:      vuln.Aliases,
			Summary:      vuln.Summary,
			Details:      vuln.Details,
			Severity:     osvSeverity(vuln),
			FixedVersion: osvFixedVersionForPackage(vuln, pkg.Name),
			PublishedAt:  parseOSVTimestamp(vuln.Published),
			ModifiedAt:   parseOSVTimestamp(vuln.Modified),
			References:   refs,
			SourceID:     vuln.ID,
			SourceURL:    vuln.DatabaseSpecific.Source,
		})
	}

	return findings, nil
}

func osvPreferredID(vuln osvVuln) string {
	for _, alias := range vuln.Aliases {
		if strings.HasPrefix(alias, "CVE-") {
			return alias
		}
	}
	return vuln.ID
}

func osvSeverity(vuln osvVuln) string {
	if vuln.DatabaseSpecific.Severity != "" {
		return vuln.DatabaseSpecific.Severity
	}
	for _, affected := range vuln.Affected {
		if affected.EcosystemSpecific.Severity != "" {
			return affected.EcosystemSpecific.Severity
		}
	}
	return models.SeverityUnknown
}

func osvFixedVersionForPackage(vuln osvVuln, pkgName string) string {
	for _, affected := range vuln.Affected {
		if affected.Package.Name != pkgName {
			continue
		}
		for _, r := range affected.Ranges {
			for _, event := range r.Events {
				if event.Fixed != "" {
					return event.Fixed
				}
			}
		}
	}
	return ""
}

func parseOSVTimestamp(value string) *time.Time {
	if value == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil
	}
	return &parsed
}
