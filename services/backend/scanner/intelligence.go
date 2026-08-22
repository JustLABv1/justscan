package scanner

import (
	"context"
	"database/sql"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"time"

	vulnerabilityintelligence "justscan-backend/functions/vulnerabilityintelligence"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

type intelligenceSnapshotDescriptor struct {
	Source         string
	Version        string
	FeedObservedAt *time.Time
	Metadata       models.JSONObject
}

type intelligenceFindingKey struct {
	VulnID      string
	PackageName string
}

// IntelligenceIngestRequest is the normalized feed contract used to add a
// new immutable intelligence version without running a scan. An empty
// PackageName applies the record to every historical finding for the VulnID.
type IntelligenceIngestRequest struct {
	Source         string                     `json:"source"`
	Version        string                     `json:"version"`
	FeedObservedAt *time.Time                 `json:"feed_observed_at,omitempty"`
	Metadata       models.JSONObject          `json:"metadata,omitempty"`
	Records        []IntelligenceIngestRecord `json:"records"`
}

// IntelligenceIngestRecord contains source-attributed state for one
// vulnerability/package key. Feed records are independent of scan findings;
// their FindingID is intentionally left unset when persisted.
type IntelligenceIngestRecord struct {
	VulnID           string              `json:"vuln_id"`
	PackageName      string              `json:"package_name,omitempty"`
	InstalledVersion string              `json:"installed_version,omitempty"`
	Source           string              `json:"source,omitempty"`
	ObservedAt       *time.Time          `json:"observed_at,omitempty"`
	CVEState         string              `json:"cve_state"`
	Severity         string              `json:"severity"`
	CVSSScore        float64             `json:"cvss_score"`
	CVSSVector       string              `json:"cvss_vector,omitempty"`
	AffectedRanges   []models.JSONObject `json:"affected_ranges,omitempty"`
	FixedVersions    []string            `json:"fixed_versions,omitempty"`
	ExploitSignals   []models.JSONObject `json:"exploit_signals,omitempty"`
	RawEvidence      models.JSONObject   `json:"raw_evidence,omitempty"`
	ChangeEventID    *uuid.UUID          `json:"-"`
}

// IntelligenceIngestResult reports the immutable feed version and the
// historical postures recalculated from newly inserted records.
type IntelligenceIngestResult struct {
	Version             models.VulnerabilityIntelligenceVersion `json:"version"`
	RecordsReceived     int                                     `json:"records_received"`
	RecordsInserted     int                                     `json:"records_inserted"`
	PosturesChanged     int                                     `json:"postures_changed"`
	PolicyImpactChanges []models.IntelligencePostureChange      `json:"-"`
}

// IntelligenceValidationError marks caller-provided feed data that cannot be
// safely normalized. In particular, unknown applicability is accepted and
// normalized to unknown so it becomes needs_rescan rather than not_affected.
type IntelligenceValidationError struct {
	Message string
}

func (e *IntelligenceValidationError) Error() string {
	return e.Message
}

// RecordIntelligenceSnapshot stores the source evidence available at scan
// time, then refreshes the derived posture for every historical finding with
// the same vulnerability and package key. The scanner finding itself is never
// updated by this operation.
func RecordIntelligenceSnapshot(ctx context.Context, db *bun.DB, scan *models.Scan) error {
	if db == nil {
		return fmt.Errorf("database is required")
	}
	if scan == nil {
		return fmt.Errorf("scan is required")
	}

	var findings []models.Vulnerability
	if err := db.NewSelect().Model(&findings).Where("scan_id = ?", scan.ID).Scan(ctx); err != nil {
		return fmt.Errorf("load scan findings: %w", err)
	}

	vulnIDs := make([]string, 0, len(findings))
	seenVulnIDs := make(map[string]bool, len(findings))
	for _, finding := range findings {
		if finding.VulnID == "" || seenVulnIDs[finding.VulnID] {
			continue
		}
		seenVulnIDs[finding.VulnID] = true
		vulnIDs = append(vulnIDs, finding.VulnID)
	}

	kbByID := make(map[string]models.VulnKBEntry)
	if len(vulnIDs) > 0 {
		var entries []models.VulnKBEntry
		if err := db.NewSelect().Model(&entries).Where("vuln_id IN (?)", bun.In(vulnIDs)).Scan(ctx); err != nil {
			return fmt.Errorf("load knowledge-base entries: %w", err)
		}
		for _, entry := range entries {
			kbByID[entry.VulnID] = entry
		}
	}

	descriptor := intelligenceDescriptorForScan(scan)
	observedAt := intelligenceObservedAt(scan)

	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		version, err := ensureIntelligenceVersion(ctx, tx, descriptor)
		if err != nil {
			return err
		}

		// Evidence rows reference vulnerabilities. Lock every historical finding
		// that the subsequent posture refresh can touch before inserting evidence,
		// so this transaction never acquires finding locks after a later posture
		// refresh has already started acquiring them.
		historicalFindings, err := loadHistoricalFindingsForPostureRefresh(ctx, tx, vulnIDs)
		if err != nil {
			return fmt.Errorf("load historical findings before evidence insert: %w", err)
		}
		historicalFindingIDs := make([]uuid.UUID, 0, len(historicalFindings))
		for _, finding := range historicalFindings {
			historicalFindingIDs = append(historicalFindingIDs, finding.ID)
		}
		lockedFindingIDs, err := lockHistoricalFindingsForPostureRefresh(ctx, tx, historicalFindingIDs)
		if err != nil {
			return fmt.Errorf("lock historical findings before evidence insert: %w", err)
		}
		if len(lockedFindingIDs) != len(findings) {
			lockedFindings := make([]models.Vulnerability, 0, len(findings))
			for _, finding := range findings {
				if lockedFindingIDs[finding.ID] {
					lockedFindings = append(lockedFindings, finding)
				}
			}
			findings = lockedFindings
		}

		link := &models.ScanIntelligenceVersion{
			ScanID:                scan.ID,
			IntelligenceVersionID: version.ID,
		}
		if _, err := tx.NewInsert().Model(link).On("CONFLICT DO NOTHING").Exec(ctx); err != nil {
			return fmt.Errorf("link scan to intelligence version: %w", err)
		}

		evidence := make([]models.VulnerabilityIntelligenceEvidence, 0, len(findings))
		keys := make([]intelligenceFindingKey, 0, len(findings))
		seenKeys := make(map[string]bool, len(findings))
		for _, finding := range findings {
			if finding.VulnID == "" {
				continue
			}

			key := intelligenceFindingKey{VulnID: finding.VulnID, PackageName: finding.PkgName}
			keyString := intelligenceKeyString(key)
			if !seenKeys[keyString] {
				seenKeys[keyString] = true
				keys = append(keys, key)
			}

			entry := kbByID[finding.VulnID]
			evidence = append(evidence, models.VulnerabilityIntelligenceEvidence{
				FindingID:             uuidPointer(finding.ID),
				IntelligenceVersionID: version.ID,
				VulnID:                finding.VulnID,
				PackageName:           finding.PkgName,
				InstalledVersion:      finding.InstalledVersion,
				RecordKey:             scanEvidenceRecordKey(finding.ID),
				EvidenceKind:          "scan",
				Source:                intelligenceEvidenceSource(scan, finding),
				ObservedAt:            observedAt,
				CVEState:              models.IntelligenceCVEStateAffected,
				Severity:              finding.Severity,
				CVSSScore:             finding.CVSSScore,
				CVSSVector:            finding.CVSSVector,
				AffectedRanges:        []models.JSONObject{},
				FixedVersions:         splitFixedVersions(finding.FixedVersion),
				ExploitSignals:        exploitSignals(entry),
				RawEvidence:           rawEvidenceForFinding(scan, finding, entry),
			})
		}

		if len(evidence) > 0 {
			if _, err := tx.NewInsert().Model(&evidence).
				On("CONFLICT (intelligence_version_id, source, record_key) DO NOTHING").
				Exec(ctx); err != nil {
				return fmt.Errorf("store intelligence evidence: %w", err)
			}
		}

		if _, err := refreshPostures(ctx, tx, keys); err != nil {
			return err
		}
		return nil
	})
}

func intelligenceDescriptorForScan(scan *models.Scan) intelligenceSnapshotDescriptor {
	descriptor := intelligenceSnapshotDescriptor{
		Source:   canonicalIntelligenceSource(scan.ScanProvider),
		Metadata: models.JSONObject{},
	}
	if descriptor.Source == "" {
		descriptor.Source = models.IntelligenceSourceTrivy
	}
	descriptor.Metadata["scan_provider"] = scan.ScanProvider
	descriptor.Metadata["trivy_version"] = scan.TrivyVersion
	descriptor.Metadata["grype_version"] = scan.GrypeVersion

	if scan.ScanProvider == models.ScanProviderArtifactoryXray {
		descriptor.Source = models.IntelligenceSourceXray
		descriptor.Metadata["xray_mode"] = scan.XrayMode
		descriptor.Metadata["external_scan_id"] = scan.ExternalScanID
		if scan.XrayProviderScannedAt != nil {
			descriptor.FeedObservedAt = scan.XrayProviderScannedAt
			descriptor.Version = "provider:" + scan.XrayProviderScannedAt.UTC().Format(time.RFC3339Nano)
		}
	} else if scan.TrivyVulnDBUpdatedAt != nil {
		descriptor.FeedObservedAt = scan.TrivyVulnDBUpdatedAt
		descriptor.Version = "vuln-db:" + scan.TrivyVulnDBUpdatedAt.UTC().Format(time.RFC3339Nano)
	}

	if descriptor.Version == "" && scan.TrivyVersion != "" {
		descriptor.Version = "scanner:" + strings.TrimSpace(scan.TrivyVersion)
	}
	if descriptor.Version == "" && scan.GrypeVersion != "" {
		descriptor.Version = "scanner:" + strings.TrimSpace(scan.GrypeVersion)
	}
	if descriptor.Version == "" {
		descriptor.Version = "scan:" + scan.ID.String()
	}

	if scan.TrivyVulnDBDownloadedAt != nil {
		descriptor.Metadata["trivy_vuln_db_downloaded_at"] = scan.TrivyVulnDBDownloadedAt.UTC().Format(time.RFC3339Nano)
	}
	if scan.TrivyJavaDBUpdatedAt != nil {
		descriptor.Metadata["trivy_java_db_updated_at"] = scan.TrivyJavaDBUpdatedAt.UTC().Format(time.RFC3339Nano)
	}
	return descriptor
}

func intelligenceObservedAt(scan *models.Scan) time.Time {
	if scan.CompletedAt != nil {
		return scan.CompletedAt.UTC()
	}
	if !scan.CreatedAt.IsZero() {
		return scan.CreatedAt.UTC()
	}
	return time.Now().UTC()
}

func ensureIntelligenceVersion(ctx context.Context, db bun.IDB, descriptor intelligenceSnapshotDescriptor) (models.VulnerabilityIntelligenceVersion, error) {
	descriptor.Source = canonicalIntelligenceSource(descriptor.Source)
	descriptor.Version = strings.TrimSpace(descriptor.Version)
	version := models.VulnerabilityIntelligenceVersion{
		Source:         descriptor.Source,
		Version:        descriptor.Version,
		FeedObservedAt: descriptor.FeedObservedAt,
		Metadata:       descriptor.Metadata,
	}
	if _, err := db.NewInsert().Model(&version).
		On("CONFLICT (source, version) DO NOTHING").
		Exec(ctx); err != nil {
		return version, fmt.Errorf("create intelligence version: %w", err)
	}

	var persisted models.VulnerabilityIntelligenceVersion
	if err := db.NewSelect().Model(&persisted).
		Where("source = ? AND version = ?", descriptor.Source, descriptor.Version).
		Scan(ctx); err != nil {
		return version, fmt.Errorf("load intelligence version: %w", err)
	}
	return persisted, nil
}

func intelligenceEvidenceSource(scan *models.Scan, finding models.Vulnerability) string {
	if scan.ScanProvider == models.ScanProviderArtifactoryXray {
		if source := strings.TrimSpace(finding.XraySource); source != "" {
			return canonicalIntelligenceSource(source)
		}
		if source := strings.TrimSpace(finding.DataSource); source != "" {
			return canonicalIntelligenceSource(source)
		}
		return models.IntelligenceSourceXray
	}
	if source := strings.TrimSpace(finding.DataSource); source != "" {
		return canonicalIntelligenceSource(source)
	}
	if scan.ScanProvider != "" {
		return canonicalIntelligenceSource(scan.ScanProvider)
	}
	return models.IntelligenceSourceTrivy
}

func canonicalIntelligenceSource(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func scanEvidenceRecordKey(findingID uuid.UUID) string {
	return "scan:" + findingID.String()
}

func splitFixedVersions(value string) []string {
	parts := strings.Split(value, ",")
	versions := make([]string, 0, len(parts))
	seen := make(map[string]bool, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" || seen[part] {
			continue
		}
		seen[part] = true
		versions = append(versions, part)
	}
	return versions
}

func exploitSignals(entry models.VulnKBEntry) []models.JSONObject {
	signals := make([]models.JSONObject, 0)
	if entry.ExploitAvailable {
		signals = append(signals, models.JSONObject{
			"type":      "known_exploit",
			"available": true,
		})
	}
	for _, reference := range entry.References {
		url := strings.ToLower(strings.TrimSpace(reference.URL))
		if url == "" || (!strings.Contains(url, "exploit") && !strings.Contains(url, "packetstormsecurity")) {
			continue
		}
		signals = append(signals, models.JSONObject{
			"type":   "exploit_reference",
			"url":    reference.URL,
			"source": reference.Source,
		})
	}
	return signals
}

func rawEvidenceForFinding(scan *models.Scan, finding models.Vulnerability, entry models.VulnKBEntry) models.JSONObject {
	raw := models.JSONObject{
		"scan_provider": scan.ScanProvider,
		"data_source":   finding.DataSource,
		"references":    finding.References,
	}
	if entry.VulnID != "" {
		raw["kb_fetched_at"] = entry.FetchedAt.UTC().Format(time.RFC3339Nano)
		raw["kb_exploit_available"] = entry.ExploitAvailable
	}
	if finding.XraySource != "" {
		raw["xray_source"] = finding.XraySource
		raw["xray_source_version"] = finding.XraySourceVersion
		raw["xray_source_id"] = finding.XraySourceID
	}
	return raw
}

func intelligenceKeyString(key intelligenceFindingKey) string {
	return key.VulnID + "\x00" + key.PackageName
}

func refreshPostures(ctx context.Context, db bun.IDB, keys []intelligenceFindingKey) (int, error) {
	changes, err := refreshPosturesWithChanges(ctx, db, keys)
	return len(changes), err
}

func refreshPosturesWithChanges(ctx context.Context, db bun.IDB, keys []intelligenceFindingKey) ([]models.IntelligencePostureChange, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	changes := make([]models.IntelligencePostureChange, 0)

	vulnIDs := make([]string, 0, len(keys))
	seenVulnIDs := make(map[string]bool, len(keys))
	for _, key := range keys {
		if !seenVulnIDs[key.VulnID] {
			seenVulnIDs[key.VulnID] = true
			vulnIDs = append(vulnIDs, key.VulnID)
		}
	}
	sort.Strings(vulnIDs)

	findings, err := loadHistoricalFindingsForPostureRefresh(ctx, db, vulnIDs)
	if err != nil {
		return nil, fmt.Errorf("load historical findings for posture refresh: %w", err)
	}
	findingIDs := make([]uuid.UUID, 0, len(findings))
	for _, finding := range findings {
		findingIDs = append(findingIDs, finding.ID)
	}
	lockedFindingIDs, err := lockHistoricalFindingsForPostureRefresh(ctx, db, findingIDs)
	if err != nil {
		return nil, fmt.Errorf("lock historical findings for posture refresh: %w", err)
	}
	if len(lockedFindingIDs) != len(findings) {
		// A scan deletion may have won a race after the historical finding query.
		// Keep only rows that still exist and are locked by this transaction.
		lockedFindings := make([]models.Vulnerability, 0, len(lockedFindingIDs))
		for _, finding := range findings {
			if lockedFindingIDs[finding.ID] {
				lockedFindings = append(lockedFindings, finding)
			}
		}
		findings = lockedFindings
	}
	baselineByScanID, err := loadScanIntelligenceBaselines(ctx, db, findings)
	if err != nil {
		return nil, fmt.Errorf("load scan completion baselines for posture refresh: %w", err)
	}

	identityByFinding := make(map[uuid.UUID]vulnerabilityFindingIdentity, len(findings))
	for _, finding := range findings {
		identityByFinding[finding.ID] = vulnerabilityFindingIdentity{
			PackageName:      finding.PkgName,
			InstalledVersion: finding.InstalledVersion,
			PURLs:            []string{},
		}
	}
	if len(findings) > 0 {
		type findingPackageURLRow struct {
			VulnerabilityID uuid.UUID `bun:"vulnerability_id"`
			PackageURL      string    `bun:"package_url"`
		}
		findingIDs = findingIDs[:0]
		for _, finding := range findings {
			findingIDs = append(findingIDs, finding.ID)
		}
		var packageURLRows []findingPackageURLRow
		if err := db.NewSelect().
			TableExpr("vulnerability_component_links AS vcl").
			ColumnExpr("vcl.vulnerability_id, sc.package_url").
			Join("JOIN sbom_components AS sc ON sc.id = vcl.component_id").
			Where("vcl.vulnerability_id IN (?)", bun.In(findingIDs)).
			Scan(ctx, &packageURLRows); err != nil {
			return nil, fmt.Errorf("load package identity evidence for posture refresh: %w", err)
		}
		for _, row := range packageURLRows {
			purl := strings.TrimSpace(row.PackageURL)
			if purl == "" {
				continue
			}
			identity := identityByFinding[row.VulnerabilityID]
			identity.PURLs = append(identity.PURLs, purl)
			identityByFinding[row.VulnerabilityID] = identity
		}
	}

	var evidence []models.VulnerabilityIntelligenceEvidence
	if err := db.NewSelect().Model(&evidence).
		Where("vuln_id IN (?)", bun.In(vulnIDs)).
		OrderExpr("observed_at DESC, created_at DESC, id DESC").
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("load intelligence evidence for posture refresh: %w", err)
	}

	versionIDs := make([]uuid.UUID, 0, len(evidence))
	seenVersionIDs := make(map[uuid.UUID]bool, len(evidence))
	for _, record := range evidence {
		if !seenVersionIDs[record.IntelligenceVersionID] {
			seenVersionIDs[record.IntelligenceVersionID] = true
			versionIDs = append(versionIDs, record.IntelligenceVersionID)
		}
	}
	versionNames := make(map[uuid.UUID]string, len(versionIDs))
	if len(versionIDs) > 0 {
		var versions []models.VulnerabilityIntelligenceVersion
		if err := db.NewSelect().Model(&versions).Where("id IN (?)", bun.In(versionIDs)).Scan(ctx); err != nil {
			return nil, fmt.Errorf("load intelligence version names: %w", err)
		}
		for _, version := range versions {
			versionNames[version.ID] = version.Version
		}
	}

	evidenceByKey := make(map[string][]models.VulnerabilityIntelligenceEvidence)
	wildcardEvidenceByVuln := make(map[string][]models.VulnerabilityIntelligenceEvidence)
	for _, record := range evidence {
		if strings.TrimSpace(record.PackageName) == "" {
			wildcardEvidenceByVuln[record.VulnID] = append(wildcardEvidenceByVuln[record.VulnID], record)
			continue
		}
		key := intelligenceKeyString(intelligenceFindingKey{VulnID: record.VulnID, PackageName: record.PackageName})
		evidenceByKey[key] = append(evidenceByKey[key], record)
	}

	requestedKeys := make(map[string]bool, len(keys))
	for _, key := range keys {
		requestedKeys[intelligenceKeyString(key)] = true
	}

	for _, finding := range findings {
		if !intelligenceKeyRequested(requestedKeys, finding) {
			continue
		}

		exactKey := intelligenceKeyString(intelligenceFindingKey{VulnID: finding.VulnID, PackageName: finding.PkgName})
		latest := latestPostScanEvidenceForFinding(
			evidenceByKey[exactKey],
			wildcardEvidenceByVuln[finding.VulnID],
			baselineByScanID[finding.ScanID],
		)
		if len(latest) == 0 {
			continue
		}

		posture := derivePostureForIdentity(finding, identityByFinding[finding.ID], latest, versionNames)
		existing, err := loadCurrentPostureForUpdate(ctx, db, finding.ID)
		if err != nil && err != sql.ErrNoRows {
			return nil, fmt.Errorf("load current posture for finding %s: %w", finding.ID, err)
		}

		hasExisting := err == nil
		if hasExisting && !postureChanged(existing, posture) {
			continue
		}

		previousState := ""
		if hasExisting {
			previousState = existing.State
			if _, err := db.NewUpdate().Model(&posture).
				Column("scan_id", "state", "cve_state", "severity", "cvss_score", "cvss_vector", "affected_ranges", "fixed_versions", "exploit_signals", "source", "observed_at", "reason", "intelligence_version_id", "intelligence_version", "conflict_sources", "change_event_id", "updated_at").
				Where("finding_id = ?", finding.ID).Exec(ctx); err != nil {
				return nil, fmt.Errorf("update posture for finding %s: %w", finding.ID, err)
			}
		} else {
			if _, err := upsertVulnerabilityPostureQuery(db, &posture).Exec(ctx); err != nil {
				return nil, fmt.Errorf("upsert posture for finding %s: %w", finding.ID, err)
			}
		}

		var previous *models.VulnerabilityPosture
		if hasExisting {
			previous = &existing
		}
		event := postureEventForTransition(finding.ID, previous, posture, previousState)
		if _, err := db.NewInsert().Model(event).Exec(ctx); err != nil {
			return nil, fmt.Errorf("record posture event for finding %s: %w", finding.ID, err)
		}
		changes = append(changes, models.IntelligencePostureChange{
			PostureEventID: event.ID,
			FindingID:      finding.ID,
			ScanID:         finding.ScanID,
			VulnID:         finding.VulnID,
			PreviousState:  previousState,
			State:          posture.State,
			Reason:         posture.Reason,
			ChangeEventID:  posture.ChangeEventID,
		})
	}

	return changes, nil
}

func loadCurrentPostureForUpdate(ctx context.Context, db bun.IDB, findingID uuid.UUID) (models.VulnerabilityPosture, error) {
	var posture models.VulnerabilityPosture
	err := currentPostureForUpdateQuery(db, findingID).Scan(ctx, &posture)
	return posture, err
}

func currentPostureForUpdateQuery(db bun.IDB, findingID uuid.UUID) *bun.SelectQuery {
	return db.NewSelect().
		Model((*models.VulnerabilityPosture)(nil)).
		Where("finding_id = ?", findingID).
		For("UPDATE")
}

// lockHistoricalFindingsForPostureRefresh acquires all finding locks before
// any posture lock. Scan deletion uses the same parent-before-child order,
// and sorting the lock query prevents two refresh transactions from taking
// overlapping finding locks in different orders.
func lockHistoricalFindingsForPostureRefresh(ctx context.Context, db bun.IDB, findingIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	locked := make(map[uuid.UUID]bool, len(findingIDs))
	if len(findingIDs) == 0 {
		return locked, nil
	}

	var lockedIDs []uuid.UUID
	err := findingForPostureRefreshQuery(db, findingIDs).Scan(ctx, &lockedIDs)
	if err != nil {
		return nil, err
	}
	for _, findingID := range lockedIDs {
		locked[findingID] = true
	}
	return locked, nil
}

func findingForPostureRefreshQuery(db bun.IDB, findingIDs []uuid.UUID) *bun.SelectQuery {
	return db.NewSelect().
		TableExpr("vulnerabilities").
		ColumnExpr("id").
		Where("id IN (?)", bun.In(findingIDs)).
		OrderExpr("id ASC").
		For("UPDATE")
}

// LockVulnerabilitiesForUpdate acquires all vulnerability rows belonging to
// the given scans in the same order used by posture refreshes. Scan deletion
// calls this inside its transaction before deleting any dependent rows, which
// keeps the parent-before-child lock order consistent across both workflows.
func LockVulnerabilitiesForUpdate(ctx context.Context, db bun.IDB, scanIDs []uuid.UUID) error {
	if len(scanIDs) == 0 {
		return nil
	}

	var findingIDs []uuid.UUID
	if err := vulnerabilitiesForScanUpdateQuery(db, scanIDs).Scan(ctx, &findingIDs); err != nil {
		return err
	}
	return nil
}

func vulnerabilitiesForScanUpdateQuery(db bun.IDB, scanIDs []uuid.UUID) *bun.SelectQuery {
	return db.NewSelect().
		TableExpr("vulnerabilities").
		ColumnExpr("id").
		Where("scan_id IN (?)", bun.In(scanIDs)).
		OrderExpr("id ASC").
		For("UPDATE")
}

func upsertVulnerabilityPostureQuery(db bun.IDB, posture *models.VulnerabilityPosture) *bun.InsertQuery {
	return db.NewInsert().
		Model(posture).
		On("CONFLICT (finding_id) DO UPDATE").
		Set(`scan_id = EXCLUDED.scan_id,
			state = EXCLUDED.state,
			cve_state = EXCLUDED.cve_state,
			severity = EXCLUDED.severity,
			cvss_score = EXCLUDED.cvss_score,
			cvss_vector = EXCLUDED.cvss_vector,
			affected_ranges = EXCLUDED.affected_ranges,
			fixed_versions = EXCLUDED.fixed_versions,
			exploit_signals = EXCLUDED.exploit_signals,
			source = EXCLUDED.source,
			observed_at = EXCLUDED.observed_at,
			reason = EXCLUDED.reason,
			intelligence_version_id = EXCLUDED.intelligence_version_id,
			intelligence_version = EXCLUDED.intelligence_version,
			conflict_sources = EXCLUDED.conflict_sources,
			change_event_id = EXCLUDED.change_event_id,
			updated_at = NOW()`)
}

// loadHistoricalFindingsForPostureRefresh intentionally joins scans. Older
// installations can contain vulnerability rows whose scan was deleted before
// scan deletion consistently removed all dependent rows. Such a row cannot
// receive a posture because vulnerability_postures.scan_id is required to
// reference an existing scan; excluding it keeps one orphan from aborting the
// complete feed refresh.
func loadHistoricalFindingsForPostureRefresh(ctx context.Context, db bun.IDB, vulnIDs []string) ([]models.Vulnerability, error) {
	var findings []models.Vulnerability
	if err := historicalFindingsForPostureRefreshQuery(db, vulnIDs).Scan(ctx, &findings); err != nil {
		return nil, err
	}
	return findings, nil
}

func historicalFindingsForPostureRefreshQuery(db bun.IDB, vulnIDs []string) *bun.SelectQuery {
	return db.NewSelect().
		TableExpr("vulnerabilities AS v").
		ColumnExpr("v.*").
		Join("JOIN scans AS s ON s.id = v.scan_id").
		Where("v.vuln_id IN (?)", bun.In(vulnIDs))
}

func intelligenceKeyRequested(requestedKeys map[string]bool, finding models.Vulnerability) bool {
	exactKey := intelligenceKeyString(intelligenceFindingKey{VulnID: finding.VulnID, PackageName: finding.PkgName})
	wildcardKey := intelligenceKeyString(intelligenceFindingKey{VulnID: finding.VulnID})
	return requestedKeys[exactKey] || requestedKeys[wildcardKey]
}

func postureEventForTransition(findingID uuid.UUID, previous *models.VulnerabilityPosture, next models.VulnerabilityPosture, previousState string) *models.VulnerabilityPostureEvent {
	event := &models.VulnerabilityPostureEvent{
		FindingID:              findingID,
		PreviousState:          previousState,
		State:                  next.State,
		Source:                 next.Source,
		ObservedAt:             next.ObservedAt,
		Reason:                 next.Reason,
		IntelligenceVersionID:  next.IntelligenceVersionID,
		ConflictSources:        cloneStringSlice(next.ConflictSources),
		PreviousAffectedRanges: []models.JSONObject{},
		AffectedRanges:         cloneJSONObjectSlice(next.AffectedRanges),
		PreviousFixedVersions:  []string{},
		FixedVersions:          cloneStringSlice(next.FixedVersions),
		CVEState:               next.CVEState,
		Severity:               next.Severity,
		CVSSScore:              next.CVSSScore,
		CVSSVector:             next.CVSSVector,
		ChangeEventID:          next.ChangeEventID,
	}
	if previous == nil {
		return event
	}
	event.PreviousCVEState = previous.CVEState
	event.PreviousSeverity = previous.Severity
	event.PreviousCVSSScore = previous.CVSSScore
	event.PreviousCVSSVector = previous.CVSSVector
	event.PreviousAffectedRanges = cloneJSONObjectSlice(previous.AffectedRanges)
	event.PreviousFixedVersions = cloneStringSlice(previous.FixedVersions)
	return event
}

type evidenceCandidate struct {
	record      models.VulnerabilityIntelligenceEvidence
	specificity int
}

func loadScanIntelligenceBaselines(ctx context.Context, db bun.IDB, findings []models.Vulnerability) (map[uuid.UUID]*time.Time, error) {
	baselines := make(map[uuid.UUID]*time.Time)
	if len(findings) == 0 {
		return baselines, nil
	}

	scanIDs := make([]uuid.UUID, 0, len(findings))
	seen := make(map[uuid.UUID]bool, len(findings))
	for _, finding := range findings {
		if finding.ScanID == uuid.Nil || seen[finding.ScanID] {
			continue
		}
		seen[finding.ScanID] = true
		scanIDs = append(scanIDs, finding.ScanID)
	}
	if len(scanIDs) == 0 {
		return baselines, nil
	}

	type baselineRow struct {
		ID          uuid.UUID  `bun:"id"`
		CompletedAt *time.Time `bun:"completed_at"`
	}
	var rows []baselineRow
	if err := db.NewSelect().
		TableExpr("scans").
		Column("id", "completed_at").
		Where("id IN (?)", bun.In(scanIDs)).
		Scan(ctx, &rows); err != nil {
		return nil, err
	}
	for _, row := range rows {
		baselines[row.ID] = row.CompletedAt
	}
	return baselines, nil
}

// latestPostScanEvidenceForFinding excludes intelligence already known when
// the scan completed. Change-event evidence uses its local creation time
// because a provider may report an old observed_at value for a newly received
// change.
func latestPostScanEvidenceForFinding(exact, wildcard []models.VulnerabilityIntelligenceEvidence, completedAt *time.Time) []models.VulnerabilityIntelligenceEvidence {
	if completedAt == nil || completedAt.IsZero() {
		return latestEvidenceForFinding(exact, wildcard)
	}
	filter := func(records []models.VulnerabilityIntelligenceEvidence) []models.VulnerabilityIntelligenceEvidence {
		result := make([]models.VulnerabilityIntelligenceEvidence, 0, len(records))
		for _, record := range records {
			detectedAt := record.ObservedAt
			if record.ChangeEventID != nil && !record.CreatedAt.IsZero() {
				detectedAt = record.CreatedAt
			}
			if detectedAt.After(*completedAt) {
				result = append(result, record)
			}
		}
		return result
	}
	return latestEvidenceForFinding(filter(exact), filter(wildcard))
}

// latestEvidenceForFinding selects one current record per source. Feed
// records take precedence over scan snapshots, and package-specific records
// take precedence over wildcard records. This allows a newer independent feed
// to update an old finding without losing source conflicts.
func latestEvidenceForFinding(exact, wildcard []models.VulnerabilityIntelligenceEvidence) []models.VulnerabilityIntelligenceEvidence {
	bySource := make(map[string]evidenceCandidate)
	consider := func(records []models.VulnerabilityIntelligenceEvidence, specificity int) {
		for _, record := range records {
			source := canonicalIntelligenceSource(record.Source)
			if source == "" {
				continue
			}
			record.Source = source
			candidate := evidenceCandidate{record: record, specificity: specificity}
			current, ok := bySource[source]
			if !ok || evidenceCandidatePreferred(candidate, current) {
				bySource[source] = candidate
			}
		}
	}

	consider(wildcard, 0)
	consider(exact, 1)

	result := make([]models.VulnerabilityIntelligenceEvidence, 0, len(bySource))
	for _, candidate := range bySource {
		result = append(result, candidate.record)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Source < result[j].Source
	})
	return result
}

func evidenceCandidatePreferred(left, right evidenceCandidate) bool {
	leftFeed := strings.EqualFold(left.record.EvidenceKind, "feed")
	rightFeed := strings.EqualFold(right.record.EvidenceKind, "feed")
	if leftFeed != rightFeed {
		return leftFeed
	}
	if left.specificity != right.specificity {
		return left.specificity > right.specificity
	}
	return intelligenceEvidenceIsNewer(left.record, right.record)
}

func intelligenceEvidenceIsNewer(left, right models.VulnerabilityIntelligenceEvidence) bool {
	if left.ObservedAt.After(right.ObservedAt) {
		return true
	}
	if left.ObservedAt.Before(right.ObservedAt) {
		return false
	}
	if left.CreatedAt.After(right.CreatedAt) {
		return true
	}
	return left.CreatedAt.Equal(right.CreatedAt) && left.ID.String() > right.ID.String()
}

func intelligenceEvidenceConflicts(records []models.VulnerabilityIntelligenceEvidence) bool {
	if len(records) < 2 {
		return false
	}
	base := records[0]
	for _, record := range records[1:] {
		if base.CVEState != record.CVEState ||
			base.Severity != record.Severity ||
			base.CVSSScore != record.CVSSScore ||
			base.CVSSVector != record.CVSSVector ||
			!equalJSONObjectSlices(base.AffectedRanges, record.AffectedRanges) ||
			!equalStringSets(base.FixedVersions, record.FixedVersions) ||
			!equalJSONObjectSlices(base.ExploitSignals, record.ExploitSignals) {
			return true
		}
	}
	return false
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func equalStringSets(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	leftCopy := append([]string{}, left...)
	rightCopy := append([]string{}, right...)
	sort.Strings(leftCopy)
	sort.Strings(rightCopy)
	return equalStrings(leftCopy, rightCopy)
}

func equalJSONObjectSlices(left, right []models.JSONObject) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if !reflect.DeepEqual(left[i], right[i]) {
			return false
		}
	}
	return true
}

func postureChanged(existing, next models.VulnerabilityPosture) bool {
	return existing.State != next.State ||
		existing.CVEState != next.CVEState ||
		existing.Severity != next.Severity ||
		existing.CVSSScore != next.CVSSScore ||
		existing.CVSSVector != next.CVSSVector ||
		!equalJSONObjectSlices(existing.AffectedRanges, next.AffectedRanges) ||
		!equalStringSets(existing.FixedVersions, next.FixedVersions) ||
		!equalJSONObjectSlices(existing.ExploitSignals, next.ExploitSignals) ||
		existing.Source != next.Source ||
		!existing.ObservedAt.Equal(next.ObservedAt) ||
		existing.IntelligenceVersion != next.IntelligenceVersion ||
		!equalUUIDPointers(existing.IntelligenceVersionID, next.IntelligenceVersionID) ||
		!equalStrings(existing.ConflictSources, next.ConflictSources)
}

func equalUUIDPointers(left, right *uuid.UUID) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func uuidPointer(value uuid.UUID) *uuid.UUID {
	if value == uuid.Nil {
		return nil
	}
	copy := value
	return &copy
}

const maxIntelligenceIngestRecords = 10000

// IngestIntelligence persists a source feed version and recalculates current
// postures for matching historical findings. It never updates the original
// vulnerability row or the scan's compliance result.
func IngestIntelligence(ctx context.Context, db *bun.DB, request IntelligenceIngestRequest) (IntelligenceIngestResult, error) {
	result := IntelligenceIngestResult{RecordsReceived: len(request.Records)}
	request, err := normalizeIntelligenceIngestRequest(request)
	if err != nil {
		return result, err
	}

	descriptor := intelligenceSnapshotDescriptor{
		Source:         request.Source,
		Version:        request.Version,
		FeedObservedAt: request.FeedObservedAt,
		Metadata:       request.Metadata,
	}
	keys := make([]intelligenceFindingKey, 0, len(request.Records))
	seenKeys := make(map[string]bool, len(request.Records))
	for _, record := range request.Records {
		key := intelligenceFindingKey{VulnID: record.VulnID, PackageName: record.PackageName}
		keyString := intelligenceKeyString(key)
		if !seenKeys[keyString] {
			seenKeys[keyString] = true
			keys = append(keys, key)
		}
	}

	if db == nil {
		return result, fmt.Errorf("database is required")
	}

	var policyImpactChanges []models.IntelligencePostureChange
	err = db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		version, err := ensureIntelligenceVersion(ctx, tx, descriptor)
		if err != nil {
			return err
		}
		result.Version = version

		evidence := make([]models.VulnerabilityIntelligenceEvidence, 0, len(request.Records))
		for _, record := range request.Records {
			observedAt := time.Now().UTC()
			if record.ObservedAt != nil {
				observedAt = *record.ObservedAt
			}
			evidence = append(evidence, models.VulnerabilityIntelligenceEvidence{
				FindingID:             nil,
				IntelligenceVersionID: version.ID,
				VulnID:                record.VulnID,
				PackageName:           record.PackageName,
				InstalledVersion:      record.InstalledVersion,
				RecordKey:             feedEvidenceRecordKey(record.VulnID, record.PackageName),
				EvidenceKind:          "feed",
				Source:                record.Source,
				ObservedAt:            observedAt,
				CVEState:              record.CVEState,
				Severity:              record.Severity,
				CVSSScore:             record.CVSSScore,
				CVSSVector:            record.CVSSVector,
				AffectedRanges:        record.AffectedRanges,
				FixedVersions:         record.FixedVersions,
				ExploitSignals:        record.ExploitSignals,
				RawEvidence:           record.RawEvidence,
				ChangeEventID:         record.ChangeEventID,
			})
		}

		insertResult, err := tx.NewInsert().Model(&evidence).
			On("CONFLICT (intelligence_version_id, source, record_key) DO NOTHING").
			Exec(ctx)
		if err != nil {
			return fmt.Errorf("store intelligence feed records: %w", err)
		}
		if rows, rowsErr := insertResult.RowsAffected(); rowsErr == nil {
			result.RecordsInserted = int(rows)
		} else {
			result.RecordsInserted = len(evidence)
		}

		changes, err := refreshPosturesWithChanges(ctx, tx, keys)
		if err != nil {
			return err
		}
		policyImpactChanges = changes
		result.PosturesChanged = len(changes)
		return nil
	})
	if err != nil {
		return IntelligenceIngestResult{RecordsReceived: result.RecordsReceived}, err
	}
	result.PolicyImpactChanges = policyImpactChanges
	return result, nil
}

func normalizeIntelligenceIngestRequest(request IntelligenceIngestRequest) (IntelligenceIngestRequest, error) {
	request.Source = canonicalIntelligenceSource(request.Source)
	request.Version = strings.TrimSpace(request.Version)
	if request.Source == "" {
		return request, intelligenceValidationError("source is required")
	}
	if request.Version == "" {
		return request, intelligenceValidationError("version is required")
	}
	if len(request.Records) == 0 {
		return request, intelligenceValidationError("at least one intelligence record is required")
	}
	if len(request.Records) > maxIntelligenceIngestRecords {
		return request, intelligenceValidationError(fmt.Sprintf("records cannot exceed %d items", maxIntelligenceIngestRecords))
	}
	if request.FeedObservedAt == nil {
		now := time.Now().UTC()
		request.FeedObservedAt = &now
	} else {
		observedAt := request.FeedObservedAt.UTC()
		request.FeedObservedAt = &observedAt
	}
	if request.Metadata == nil {
		request.Metadata = models.JSONObject{}
	}

	seen := make(map[string]bool, len(request.Records))
	for i := range request.Records {
		record := &request.Records[i]
		record.VulnID = strings.TrimSpace(record.VulnID)
		if record.VulnID == "" {
			return request, intelligenceValidationError(fmt.Sprintf("records[%d].vuln_id is required", i))
		}
		record.PackageName = strings.TrimSpace(record.PackageName)
		record.InstalledVersion = strings.TrimSpace(record.InstalledVersion)
		record.Source = canonicalIntelligenceSource(record.Source)
		if record.Source == "" {
			record.Source = request.Source
		}
		record.CVEState = normalizeIntelligenceCVEState(record.CVEState)
		record.Severity = normalizeSeverity(record.Severity)
		record.CVSSVector = strings.TrimSpace(record.CVSSVector)
		if record.CVSSScore < 0 || record.CVSSScore > 10 {
			return request, intelligenceValidationError(fmt.Sprintf("records[%d].cvss_score must be between 0 and 10", i))
		}
		if record.ObservedAt == nil {
			observedAt := *request.FeedObservedAt
			record.ObservedAt = &observedAt
		} else {
			observedAt := record.ObservedAt.UTC()
			record.ObservedAt = &observedAt
		}
		record.AffectedRanges = normalizeJSONObjectSlice(record.AffectedRanges)
		record.FixedVersions = normalizeStringSlice(record.FixedVersions)
		record.ExploitSignals = normalizeJSONObjectSlice(record.ExploitSignals)
		if record.RawEvidence == nil {
			record.RawEvidence = models.JSONObject{}
		}

		key := record.Source + "\x00" + record.VulnID + "\x00" + record.PackageName
		if seen[key] {
			return request, intelligenceValidationError(fmt.Sprintf("records[%d] duplicates source, vuln_id, and package_name", i))
		}
		seen[key] = true
	}
	return request, nil
}

func intelligenceValidationError(message string) error {
	return &IntelligenceValidationError{Message: message}
}

func normalizeIntelligenceCVEState(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "-", "_")
	value = strings.ReplaceAll(value, " ", "_")
	switch value {
	case models.IntelligenceCVEStateAffected,
		models.IntelligenceCVEStateDisputed,
		models.IntelligenceCVEStateRejected,
		models.IntelligenceCVEStateNotAffected:
		return value
	case "notaffected", "unaffected":
		return models.IntelligenceCVEStateNotAffected
	default:
		return models.IntelligenceCVEStateUnknown
	}
}

func normalizeStringSlice(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func normalizeJSONObjectSlice(values []models.JSONObject) []models.JSONObject {
	result := make([]models.JSONObject, 0, len(values))
	for _, value := range values {
		if value == nil {
			result = append(result, models.JSONObject{})
			continue
		}
		result = append(result, value)
	}
	return result
}

func cloneJSONObjectSlice(values []models.JSONObject) []models.JSONObject {
	result := make([]models.JSONObject, 0, len(values))
	result = append(result, values...)
	return result
}

func feedEvidenceRecordKey(vulnID, packageName string) string {
	return "feed:" + vulnID + "\x00" + packageName
}

// AttachVulnerabilityIntelligence adds the immutable scan-time evidence and
// latest derived posture to API response models.
func AttachVulnerabilityIntelligence(ctx context.Context, db *bun.DB, vulnerabilities []models.Vulnerability) error {
	if len(vulnerabilities) == 0 {
		return nil
	}

	findingIDs := make([]uuid.UUID, 0, len(vulnerabilities))
	for _, vulnerability := range vulnerabilities {
		if vulnerability.ID != uuid.Nil {
			findingIDs = append(findingIDs, vulnerability.ID)
		}
	}
	if len(findingIDs) == 0 {
		return nil
	}

	var evidence []models.VulnerabilityIntelligenceEvidence
	if err := db.NewSelect().Model(&evidence).
		Where("finding_id IN (?)", bun.In(findingIDs)).
		OrderExpr("observed_at ASC, created_at ASC").
		Scan(ctx); err != nil {
		return fmt.Errorf("load scan-time intelligence: %w", err)
	}
	byFinding := make(map[uuid.UUID][]models.VulnerabilityIntelligenceEvidence, len(findingIDs))
	for _, record := range evidence {
		if record.FindingID == nil {
			continue
		}
		byFinding[*record.FindingID] = append(byFinding[*record.FindingID], record)
	}

	var postures []models.VulnerabilityPosture
	if err := db.NewSelect().
		TableExpr("vulnerability_postures AS p").
		ColumnExpr("p.*").
		Join("JOIN scans AS intelligence_scan ON intelligence_scan.id = p.scan_id").
		Where("p.finding_id IN (?)", bun.In(findingIDs)).
		Where(vulnerabilityintelligence.PostScanChangeCondition("p", "intelligence_scan")).
		Scan(ctx, &postures); err != nil {
		return fmt.Errorf("load current vulnerability postures: %w", err)
	}
	postureByFinding := make(map[uuid.UUID]*models.VulnerabilityPosture, len(postures))
	for i := range postures {
		postureByFinding[postures[i].FindingID] = &postures[i]
	}

	for i := range vulnerabilities {
		vulnerabilities[i].ScanTimeIntelligence = byFinding[vulnerabilities[i].ID]
		vulnerabilities[i].CurrentPosture = postureByFinding[vulnerabilities[i].ID]
	}
	return nil
}

// LoadScanIntelligenceVersions loads the feed snapshots associated with a scan.
func LoadScanIntelligenceVersions(ctx context.Context, db *bun.DB, scanID uuid.UUID) ([]models.VulnerabilityIntelligenceVersion, error) {
	var versions []models.VulnerabilityIntelligenceVersion
	if err := db.NewSelect().
		TableExpr("vulnerability_intelligence_versions AS v").
		ColumnExpr("v.*").
		Join("JOIN scan_intelligence_versions AS siv ON siv.intelligence_version_id = v.id").
		Where("siv.scan_id = ?", scanID).
		OrderExpr("v.source ASC, v.version ASC").
		Scan(ctx, &versions); err != nil {
		return nil, fmt.Errorf("load scan intelligence versions: %w", err)
	}
	return versions, nil
}

// BackfillVulnerabilityIntelligence asynchronously captures evidence for
// historical scans after an additive migration. It is safe to retry because
// scan/version and finding/version/source writes are idempotent.
func BackfillVulnerabilityIntelligence(db *bun.DB) {
	ctx := context.Background()
	for {
		var scanIDs []uuid.UUID
		if err := db.NewSelect().
			TableExpr("scans AS s").
			ColumnExpr("s.id").
			Where("NOT EXISTS (SELECT 1 FROM scan_intelligence_versions siv WHERE siv.scan_id = s.id)").
			OrderExpr("s.created_at ASC, s.id ASC").
			Limit(100).
			Scan(ctx, &scanIDs); err != nil {
			logrus.Warnf("Intelligence backfill: failed to find historical scans: %v", err)
			return
		}
		if len(scanIDs) == 0 {
			return
		}

		completed := 0
		for _, scanID := range scanIDs {
			scan := &models.Scan{}
			if err := db.NewSelect().Model(scan).Where("id = ?", scanID).Scan(ctx); err != nil {
				logrus.Warnf("Intelligence backfill: failed to load scan %s: %v", scanID, err)
				continue
			}
			if err := RecordIntelligenceSnapshot(ctx, db, scan); err != nil {
				logrus.Warnf("Intelligence backfill: failed for scan %s: %v", scanID, err)
				continue
			}
			completed++
		}
		if completed == 0 {
			return
		}
	}
}
