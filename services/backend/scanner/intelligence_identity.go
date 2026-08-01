package scanner

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"justscan-backend/pkg/models"

	"github.com/Masterminds/semver/v3"
	"github.com/google/uuid"
)

// vulnerabilityFindingIdentity contains the package evidence available when
// a historical finding is re-evaluated. Package URLs are preferred because a
// package name alone is ambiguous across ecosystems and namespaces.
type vulnerabilityFindingIdentity struct {
	PackageName      string
	InstalledVersion string
	PURLs            []string
}

type applicabilityState uint8

const (
	applicabilityUnknown applicabilityState = iota
	applicabilityAffected
	applicabilityNotAffected
)

// derivePosture is kept as the small, test-friendly entry point used by the
// original intelligence implementation. Database-backed refreshes call the
// identity-aware variant below.
func derivePosture(finding models.Vulnerability, latest []models.VulnerabilityIntelligenceEvidence, versionNames map[uuid.UUID]string) models.VulnerabilityPosture {
	return derivePostureForIdentity(finding, vulnerabilityFindingIdentity{
		PackageName:      finding.PkgName,
		InstalledVersion: finding.InstalledVersion,
	}, latest, versionNames)
}

func derivePostureForIdentity(finding models.Vulnerability, identity vulnerabilityFindingIdentity, latest []models.VulnerabilityIntelligenceEvidence, versionNames map[uuid.UUID]string) models.VulnerabilityPosture {
	posture := models.VulnerabilityPosture{
		FindingID:       finding.ID,
		ScanID:          finding.ScanID,
		CVEState:        models.IntelligenceCVEStateUnknown,
		Severity:        models.SeverityUnknown,
		AffectedRanges:  []models.JSONObject{},
		FixedVersions:   []string{},
		ExploitSignals:  []models.JSONObject{},
		ConflictSources: []string{},
	}

	sources := make([]string, 0, len(latest))
	for _, record := range latest {
		sources = append(sources, record.Source)
	}
	posture.Source = strings.Join(sources, ",")

	if len(latest) > 1 && intelligenceEvidenceConflicts(latest) {
		posture.State = models.PostureStateNeedsRescan
		posture.Reason = "Conflicting intelligence sources require validation before posture can be derived."
		posture.ConflictSources = append([]string(nil), sources...)
		for _, record := range latest {
			if record.ObservedAt.After(posture.ObservedAt) {
				posture.ObservedAt = record.ObservedAt
			}
		}
		return posture
	}

	representative := latest[0]
	posture.CVEState = representative.CVEState
	posture.Severity = representative.Severity
	posture.CVSSScore = representative.CVSSScore
	posture.CVSSVector = representative.CVSSVector
	posture.AffectedRanges = cloneJSONObjectSlice(representative.AffectedRanges)
	posture.FixedVersions = cloneStringSlice(representative.FixedVersions)
	posture.ExploitSignals = cloneJSONObjectSlice(representative.ExploitSignals)
	posture.ObservedAt = representative.ObservedAt
	posture.IntelligenceVersionID = uuidPointer(representative.IntelligenceVersionID)
	posture.IntelligenceVersion = versionNames[representative.IntelligenceVersionID]
	posture.ChangeEventID = cloneUUIDPointer(representative.ChangeEventID)

	posture.State, posture.Reason = derivePostureStateForIdentity(finding, identity, representative)
	if posture.CVEState == models.IntelligenceCVEStateAffected && len(posture.AffectedRanges) > 0 {
		posture.FixedVersions = fixedVersionsForIdentity(identity, representative.AffectedRanges, representative.FixedVersions)
	}
	if len(latest) > 1 {
		posture.Reason = fmt.Sprintf("Sources %s agree: %s", posture.Source, posture.Reason)
		posture.IntelligenceVersionID = nil
		posture.IntelligenceVersion = ""
		posture.ChangeEventID = nil
		for _, record := range latest[1:] {
			if record.ObservedAt.After(posture.ObservedAt) {
				posture.ObservedAt = record.ObservedAt
			}
		}
	}
	return posture
}

// derivePostureState remains the compatibility wrapper for callers that only
// have scanner finding fields. It intentionally does not claim package
// applicability when no package identity has been supplied.
func derivePostureState(finding models.Vulnerability, evidence models.VulnerabilityIntelligenceEvidence) (string, string) {
	return derivePostureStateForIdentity(finding, vulnerabilityFindingIdentity{
		PackageName:      finding.PkgName,
		InstalledVersion: finding.InstalledVersion,
	}, evidence)
}

func derivePostureStateForIdentity(finding models.Vulnerability, identity vulnerabilityFindingIdentity, evidence models.VulnerabilityIntelligenceEvidence) (string, string) {
	source := strings.TrimSpace(evidence.Source)
	if source == "" {
		source = "the intelligence feed"
	}

	switch strings.ToLower(strings.TrimSpace(evidence.CVEState)) {
	case "":
		return models.PostureStateNeedsRescan, "Intelligence applicability is unknown; rescan required."
	case models.IntelligenceCVEStateUnknown:
		return models.PostureStateNeedsRescan, fmt.Sprintf("%s did not provide applicability information; rescan required.", source)
	case models.IntelligenceCVEStateDisputed:
		return models.PostureStateDisputed, fmt.Sprintf("%s reports that the vulnerability is disputed.", source)
	case models.IntelligenceCVEStateRejected:
		return models.PostureStateRejected, fmt.Sprintf("%s reports that the vulnerability is rejected.", source)
	case models.IntelligenceCVEStateNotAffected:
		return models.PostureStateNotAffected, fmt.Sprintf("%s explicitly reports that this package is not affected.", source)
	case models.IntelligenceCVEStateAffected:
		if len(evidence.AffectedRanges) > 0 {
			switch evaluateAffectedRanges(identity, evidence.AffectedRanges) {
			case applicabilityUnknown:
				return models.PostureStateNeedsRescan, fmt.Sprintf("%s changed affected-package ranges, but the finding lacks sufficient package identity evidence; rescan required.", source)
			case applicabilityNotAffected:
				return models.PostureStateNotAffected, fmt.Sprintf("%s reports affected ranges that do not include this package version.", source)
			}
		}
		// A scanner finding with a fixed version is still affected at the
		// installed version, but the current posture should make remediation
		// available without rewriting the scan-time result.
		if len(evidence.FixedVersions) > 0 {
			return models.PostureStateFixAvailable, fmt.Sprintf("%s reports fixed version(s): %s.", source, strings.Join(evidence.FixedVersions, ", "))
		}
		currentRank := severityRank(finding.Severity)
		latestRank := severityRank(evidence.Severity)
		if latestRank > currentRank || (latestRank == currentRank && evidence.CVSSScore > finding.CVSSScore) {
			return models.PostureStateSeverityIncreased, fmt.Sprintf("%s increased the assessed severity to %s.", source, evidence.Severity)
		}
		if latestRank < currentRank || (latestRank == currentRank && evidence.CVSSScore > 0 && evidence.CVSSScore < finding.CVSSScore) {
			return models.PostureStateSeverityReduced, fmt.Sprintf("%s reduced the assessed severity to %s.", source, evidence.Severity)
		}
		return models.PostureStateUnchanged, fmt.Sprintf("%s did not change the assessed severity or remediation state.", source)
	default:
		return models.PostureStateNeedsRescan, fmt.Sprintf("%s returned an unrecognized applicability state; rescan required.", source)
	}
}

// evaluateAffectedRanges returns the safest aggregate result. An unknown
// range always wins over a not-affected range because an incomplete identity
// must not be converted into a false negative.
func evaluateAffectedRanges(identity vulnerabilityFindingIdentity, ranges []models.JSONObject) applicabilityState {
	if len(ranges) == 0 {
		return applicabilityAffected
	}

	matched := false
	unknown := false
	for _, rawRange := range ranges {
		rangeState, relevant := evaluateAffectedRange(identity, rawRange)
		if !relevant {
			continue
		}
		switch rangeState {
		case applicabilityAffected:
			matched = true
		case applicabilityUnknown:
			unknown = true
		}
	}
	if matched {
		return applicabilityAffected
	}
	if unknown {
		return applicabilityUnknown
	}
	return applicabilityNotAffected
}

func evaluateAffectedRange(identity vulnerabilityFindingIdentity, rawRange models.JSONObject) (applicabilityState, bool) {
	if rawRange == nil {
		return applicabilityUnknown, true
	}
	if rangeStatusIsUnaffected(rawRange) {
		return applicabilityNotAffected, true
	}

	identityMatch, identityUnknown, constrained := rangeIdentityMatch(identity, rawRange)
	if identityUnknown {
		return applicabilityUnknown, true
	}
	if constrained && !identityMatch {
		return applicabilityNotAffected, false
	}

	version := strings.TrimSpace(identity.InstalledVersion)
	if version == "" {
		return applicabilityUnknown, true
	}

	constraint, hasConstraint, parseErr := rangeVersionConstraint(rawRange)
	if parseErr != nil {
		return applicabilityUnknown, true
	}
	changes := jsonObjectSlice(rawRange["changes"])
	if !hasConstraint && len(changes) == 0 {
		return applicabilityAffected, true
	}
	parsedVersion, err := parseComparableVersion(version, jsonStringValue(rawRange, "version_type"))
	if err != nil {
		return applicabilityUnknown, true
	}
	if len(changes) > 0 {
		return evaluateRangeChangeTimeline(parsedVersion, rawRange, changes), true
	}
	if !hasConstraint {
		return applicabilityUnknown, true
	}
	if constraint.Check(parsedVersion) {
		return applicabilityAffected, true
	}
	return applicabilityNotAffected, true
}

func rangeIdentityMatch(identity vulnerabilityFindingIdentity, rawRange models.JSONObject) (match, unknown, constrained bool) {
	rangePURL := firstString(rawRange, "purl", "package_url", "package_url_pattern")
	if rangePURL != "" {
		constrained = true
		if len(identity.PURLs) == 0 {
			return false, true, true
		}
		normalizedRange := normalizePURLIdentity(rangePURL)
		for _, purl := range identity.PURLs {
			if normalizedRange != "" && normalizedRange == normalizePURLIdentity(purl) {
				return true, false, true
			}
		}
		return false, false, true
	}

	if identityKind := strings.ToLower(strings.TrimSpace(jsonStringValue(rawRange, "identity_kind"))); identityKind == "cpe" {
		return false, true, true
	}
	if cpe := firstString(rawRange, "cpe", "criteria"); strings.HasPrefix(strings.ToLower(cpe), "cpe:") {
		return false, true, true
	}

	rangePackage := firstString(rawRange, "package_name", "package", "name")
	if rangePackage == "" {
		return true, false, false
	}
	constrained = true
	if strings.EqualFold(normalizePackageName(rangePackage), normalizePackageName(identity.PackageName)) {
		return true, false, true
	}
	if strings.TrimSpace(identity.PackageName) == "" {
		return false, true, true
	}
	return false, false, true
}

func rangeStatusIsUnaffected(raw models.JSONObject) bool {
	status := strings.ToLower(strings.TrimSpace(firstString(raw, "status", "range_status")))
	return status == "unaffected" || status == "not_affected" || status == "notaffected" || status == "fixed"
}

func rangeVersionConstraint(raw models.JSONObject) (*semver.Constraints, bool, error) {
	parts := make([]string, 0, 6)
	versionType := strings.TrimSpace(jsonStringValue(raw, "version_type"))
	if exact := firstString(raw, "version", "exact"); exact != "" {
		operatorVersion := strings.TrimSpace(exact)
		if operatorVersion == "*" || operatorVersion == "-" {
			operatorVersion = ""
		}
		if operatorVersion == "" {
			// A wildcard version does not constrain applicability.
		} else if strings.ContainsAny(operatorVersion, "<>=") || strings.Contains(operatorVersion, " ") {
			parts = append(parts, normalizeConstraintExpression(operatorVersion))
		} else {
			parts = append(parts, "="+operatorVersion)
		}
	}
	if introduced := firstString(raw, "introduced", "version_start_including"); introduced != "" && introduced != "0" {
		parts = append(parts, ">="+introduced)
	}
	if startExcluding := firstString(raw, "version_start_excluding"); startExcluding != "" {
		parts = append(parts, ">"+startExcluding)
	}
	if fixed := firstString(raw, "fixed", "fixed_version", "version_end_excluding"); fixed != "" {
		parts = append(parts, "<"+fixed)
	}
	if endIncluding := firstString(raw, "version_end_including", "less_than_or_equal"); endIncluding != "" {
		parts = append(parts, "<="+endIncluding)
	}
	if lessThan := firstString(raw, "less_than"); lessThan != "" {
		parts = append(parts, "<"+lessThan)
	}
	if len(parts) == 0 {
		return nil, false, nil
	}
	constraint, err := semver.NewConstraint(strings.Join(parts, ","))
	if err != nil {
		return nil, true, err
	}
	_ = versionType // semver is the conservative comparison supported here.
	return constraint, true, nil
}

func normalizeConstraintExpression(value string) string {
	tokens := strings.Fields(strings.TrimSpace(value))
	if len(tokens) == 0 {
		return ""
	}
	parts := make([]string, 0, len(tokens))
	for index := 0; index < len(tokens); index++ {
		token := strings.Trim(tokens[index], ",")
		if (token == ">" || token == ">=" || token == "<" || token == "<=" || token == "=" || token == "!=") && index+1 < len(tokens) {
			index++
			parts = append(parts, token+strings.Trim(tokens[index], ","))
			continue
		}
		if token != "" {
			parts = append(parts, token)
		}
	}
	return strings.Join(parts, ",")
}

func parseComparableVersion(value, _ string) (*semver.Version, error) {
	value = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(value), "v"))
	if value == "" || value == "*" || value == "-" {
		return nil, fmt.Errorf("version is empty")
	}
	return semver.NewVersion(value)
}

func evaluateRangeChangeTimeline(version *semver.Version, rawRange models.JSONObject, changes []models.JSONObject) applicabilityState {
	type versionChange struct {
		at     *semver.Version
		status string
	}
	timeline := make([]versionChange, 0, len(changes))
	for _, change := range changes {
		at := strings.TrimSpace(firstString(change, "at", "version"))
		if at == "" {
			return applicabilityUnknown
		}
		parsed, err := parseComparableVersion(at, jsonStringValue(rawRange, "version_type"))
		if err != nil {
			return applicabilityUnknown
		}
		status := strings.ToLower(strings.TrimSpace(firstString(change, "status", "state")))
		if status == "" {
			return applicabilityUnknown
		}
		timeline = append(timeline, versionChange{at: parsed, status: status})
	}
	sort.SliceStable(timeline, func(i, j int) bool { return timeline[i].at.LessThan(timeline[j].at) })
	currentStatus := strings.ToLower(strings.TrimSpace(firstString(rawRange, "status", "range_status")))
	for _, change := range timeline {
		if version.LessThan(change.at) {
			break
		}
		currentStatus = change.status
	}
	if currentStatus == "" {
		return applicabilityUnknown
	}
	if currentStatus == "affected" || currentStatus == "vulnerable" {
		return applicabilityAffected
	}
	return applicabilityNotAffected
}

func fixedVersionsForIdentity(identity vulnerabilityFindingIdentity, ranges []models.JSONObject, supplied []string) []string {
	if len(ranges) == 0 {
		return cloneStringSlice(supplied)
	}

	applicability := evaluateAffectedRanges(identity, ranges)
	if applicability != applicabilityAffected {
		return []string{}
	}

	versions := make([]string, 0, len(supplied)+len(ranges))
	seen := make(map[string]bool)
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			versions = append(versions, value)
		}
	}
	matchingRangeCount := 0
	extractedRangeVersions := 0
	for _, rawRange := range ranges {
		if _, unknown, constrained := rangeIdentityMatch(identity, rawRange); unknown || (constrained && !rangeIdentityApplies(identity, rawRange)) {
			continue
		}
		matchingRangeCount++
		for _, key := range []string{"fixed", "fixed_version", "less_than", "less_than_or_equal", "version_end_excluding", "version_end_including"} {
			if value := firstString(rawRange, key); value != "" {
				extractedRangeVersions++
				add(value)
			}
		}
		for _, change := range jsonObjectSlice(rawRange["changes"]) {
			if strings.ToLower(strings.TrimSpace(jsonStringValue(change, "status"))) != "unaffected" {
				continue
			}
			if value := jsonStringValue(change, "at"); value != "" {
				extractedRangeVersions++
				add(value)
			}
		}
	}
	if extractedRangeVersions == 0 && matchingRangeCount > 0 {
		for _, value := range supplied {
			add(value)
		}
	}
	sort.Strings(versions)
	return versions
}

func rangeIdentityApplies(identity vulnerabilityFindingIdentity, rawRange models.JSONObject) bool {
	match, unknown, constrained := rangeIdentityMatch(identity, rawRange)
	return !unknown && (!constrained || match)
}

func cloneStringSlice(values []string) []string {
	return append([]string{}, values...)
}

func firstString(values models.JSONObject, keys ...string) string {
	for _, key := range keys {
		if value := jsonStringValue(values, key); value != "" {
			return value
		}
	}
	return ""
}

func jsonStringValue(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	switch value := values[key].(type) {
	case string:
		return strings.TrimSpace(value)
	case float64:
		return strconv.FormatFloat(value, 'f', -1, 64)
	case json.Number:
		return value.String()
	default:
		return ""
	}
}

func cloneUUIDPointer(value *uuid.UUID) *uuid.UUID {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func normalizePackageName(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizePURLIdentity(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.TrimPrefix(value, "pkg:")
	if index := strings.IndexAny(value, "?#"); index >= 0 {
		value = value[:index]
	}
	if index := strings.LastIndex(value, "/"); index >= 0 {
		if versionIndex := strings.LastIndex(value[index+1:], "@"); versionIndex >= 0 {
			value = value[:index+1+versionIndex]
		}
	}
	return value
}
