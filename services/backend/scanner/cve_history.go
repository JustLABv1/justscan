package scanner

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

const (
	cveHistorySource       = "nvd_cve_history"
	nvdHistoryURL          = "https://services.nvd.nist.gov/rest/json/cvehistory/2.0"
	nvdCVEsURL             = "https://services.nvd.nist.gov/rest/json/cves/2.0"
	officialCVEBaseURL     = "https://cveawg.mitre.org/api/cve"
	maxNVDHistoryWindow    = 120 * 24 * time.Hour
	defaultNVDRequestDelay = 6 * time.Second
	defaultHistoryPageSize = 5000
)

var ErrCVEHistorySyncRunning = errors.New("CVE history sync is already running")

// CVEHistorySyncProgress is the live, in-process progress of one sync. The
// durable run table remains the historical record; this status lets the admin
// UI show what the active worker is doing without another migration.
type CVEHistorySyncProgress struct {
	Phase           string
	EventsTotal     int
	EventsCompleted int
	EventsFailed    int
	UniqueCVEs      int
	CurrentVulnID   string
	LastProgressAt  *time.Time
}

// CVEHistorySyncStatus is the in-process state of the worker. The durable run
// table is the historical record; this status lets the admin UI show an
// actively running scheduler or manually queued sync immediately.
type CVEHistorySyncStatus struct {
	Running   bool
	StartedAt *time.Time
	Progress  CVEHistorySyncProgress
}

var cveHistoryRunState struct {
	mu        sync.Mutex
	running   bool
	startedAt *time.Time
	progress  CVEHistorySyncProgress
}

// cveHistoryRunContext owns per-run state. In particular, snapshots are
// cached only for the duration of one sync so repeated history events for the
// same CVE do not trigger the same two upstream requests over and over.
type cveHistoryRunContext struct {
	client    *cveHistoryClient
	snapshots map[string]cveCurrentSnapshot
	seenCVEs  map[string]struct{}
}

func newCVEHistoryRunContext(client *cveHistoryClient) *cveHistoryRunContext {
	return &cveHistoryRunContext{
		client:    client,
		snapshots: make(map[string]cveCurrentSnapshot),
		seenCVEs:  make(map[string]struct{}),
	}
}

func (r *cveHistoryRunContext) fetchCurrentSnapshot(ctx context.Context, cveID string) (cveCurrentSnapshot, error) {
	key := strings.ToUpper(strings.TrimSpace(cveID))
	if snapshot, ok := r.snapshots[key]; ok {
		return snapshot, nil
	}
	if _, ok := r.seenCVEs[key]; !ok {
		r.seenCVEs[key] = struct{}{}
		updateCVEHistorySyncProgress(func(progress *CVEHistorySyncProgress) {
			progress.UniqueCVEs = len(r.seenCVEs)
		})
	}
	snapshot, err := r.client.fetchCurrentSnapshot(ctx, key)
	if err != nil {
		return cveCurrentSnapshot{}, err
	}
	r.snapshots[key] = snapshot
	return snapshot, nil
}

type cveHistoryClient struct {
	nvdHistoryBaseURL  string
	nvdCVEsBaseURL     string
	officialCVEBaseURL string
	apiKey             string
	httpClient         *http.Client
	minInterval        time.Duration
	maxRetries         int
	sleep              func(context.Context, time.Duration) error

	mu            sync.Mutex
	lastRequestAt time.Time
}

type cveHistoryHTTPError struct {
	StatusCode int
	RetryAfter time.Duration
	Body       string
}

func (e *cveHistoryHTTPError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("CVE history request returned HTTP %d", e.StatusCode)
	}
	return fmt.Sprintf("CVE history request returned HTTP %d: %s", e.StatusCode, e.Body)
}

type nvdHistoryPage struct {
	ResultsPerPage int
	StartIndex     int
	TotalResults   int
	Changes        []normalizedCVEHistoryChange
}

type normalizedCVEHistoryChange struct {
	CVEID            string
	EventName        string
	SourceEventID    string
	SourceIdentifier string
	ObservedAt       time.Time
	Before           models.JSONObject
	After            models.JSONObject
	Details          []models.JSONObject
	RawPayload       models.JSONObject
}

type cveCurrentSnapshot struct {
	CVEState       string
	Severity       string
	CVSSScore      float64
	CVSSVector     string
	AffectedRanges []models.JSONObject
	FixedVersions  []string
	RawOfficial    models.JSONObject
	RawNVD         models.JSONObject
}

func newCVEHistoryClient() *cveHistoryClient {
	apiKey := ""
	if config.Config != nil {
		apiKey = strings.TrimSpace(config.Config.VulnKB.NVDApiKey)
	}
	return &cveHistoryClient{
		nvdHistoryBaseURL:  nvdHistoryURL,
		nvdCVEsBaseURL:     nvdCVEsURL,
		officialCVEBaseURL: officialCVEBaseURL,
		apiKey:             apiKey,
		httpClient:         &http.Client{Timeout: 60 * time.Second},
		minInterval:        defaultNVDRequestDelay,
		maxRetries:         3,
		sleep:              contextSleep,
	}
}

func contextSleep(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (c *cveHistoryClient) getJSON(ctx context.Context, endpoint string, destination any) error {
	if c == nil {
		return fmt.Errorf("CVE history client is required")
	}
	if c.httpClient == nil {
		c.httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	if c.sleep == nil {
		c.sleep = contextSleep
	}
	if c.maxRetries < 0 {
		c.maxRetries = 0
	}

	for attempt := 0; attempt <= c.maxRetries; attempt++ {
		if err := c.waitForRequestSlot(ctx); err != nil {
			return err
		}

		request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return fmt.Errorf("create CVE history request: %w", err)
		}
		request.Header.Set("Accept", "application/json")
		if c.apiKey != "" {
			request.Header.Set("apiKey", c.apiKey)
		}

		response, err := c.httpClient.Do(request)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if attempt == c.maxRetries {
				return fmt.Errorf("request CVE history endpoint: %w", err)
			}
			if err := c.sleep(ctx, retryDelay(attempt, 0)); err != nil {
				return err
			}
			continue
		}

		body, readErr := io.ReadAll(io.LimitReader(response.Body, 32<<20))
		response.Body.Close()
		if readErr != nil {
			return fmt.Errorf("read CVE history response: %w", readErr)
		}
		if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
			httpErr := &cveHistoryHTTPError{
				StatusCode: response.StatusCode,
				RetryAfter: parseRetryAfter(response.Header.Get("Retry-After"), time.Now()),
				Body:       strings.TrimSpace(string(body)),
			}
			if !isRetryableCVEHistoryStatus(response.StatusCode) || attempt == c.maxRetries {
				return httpErr
			}
			if err := c.sleep(ctx, retryDelay(attempt, httpErr.RetryAfter)); err != nil {
				return err
			}
			continue
		}

		if err := json.Unmarshal(body, destination); err != nil {
			return fmt.Errorf("decode CVE history response: %w", err)
		}
		return nil
	}
	return fmt.Errorf("CVE history request exhausted retries")
}

func (c *cveHistoryClient) waitForRequestSlot(ctx context.Context) error {
	c.mu.Lock()
	wait := time.Duration(0)
	if !c.lastRequestAt.IsZero() {
		wait = time.Until(c.lastRequestAt.Add(c.minInterval))
	}
	if wait < 0 {
		wait = 0
	}
	c.lastRequestAt = time.Now()
	c.mu.Unlock()
	if wait > 0 {
		if c.sleep == nil {
			c.sleep = contextSleep
		}
		return c.sleep(ctx, wait)
	}
	return nil
}

func isRetryableCVEHistoryStatus(status int) bool {
	return status == http.StatusTooManyRequests || status >= 500
}

func retryDelay(attempt int, retryAfter time.Duration) time.Duration {
	if retryAfter > 0 {
		return retryAfter
	}
	delay := time.Second << attempt
	if delay > 5*time.Minute {
		return 5 * time.Minute
	}
	return delay
}

func parseRetryAfter(value string, now time.Time) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	if timestamp, err := http.ParseTime(value); err == nil {
		if delay := timestamp.Sub(now); delay > 0 {
			return delay
		}
	}
	return 0
}

func (c *cveHistoryClient) fetchHistoryPage(ctx context.Context, start, end time.Time, startIndex int) (nvdHistoryPage, error) {
	query := url.Values{}
	query.Set("changeStartDate", start.UTC().Format(time.RFC3339))
	query.Set("changeEndDate", end.UTC().Format(time.RFC3339))
	query.Set("resultsPerPage", strconv.Itoa(defaultHistoryPageSize))
	query.Set("startIndex", strconv.Itoa(startIndex))

	var response struct {
		ResultsPerPage int               `json:"resultsPerPage"`
		StartIndex     int               `json:"startIndex"`
		TotalResults   int               `json:"totalResults"`
		CVEChanges     []json.RawMessage `json:"cveChanges"`
	}
	if err := c.getJSON(ctx, strings.TrimRight(c.nvdHistoryBaseURL, "?")+"?"+query.Encode(), &response); err != nil {
		return nvdHistoryPage{}, err
	}

	page := nvdHistoryPage{
		ResultsPerPage: response.ResultsPerPage,
		StartIndex:     response.StartIndex,
		TotalResults:   response.TotalResults,
		Changes:        make([]normalizedCVEHistoryChange, 0, len(response.CVEChanges)),
	}
	for _, raw := range response.CVEChanges {
		payload, err := rawJSONObject(raw)
		if err != nil {
			return nvdHistoryPage{}, fmt.Errorf("decode NVD CVE change: %w", err)
		}
		change, err := normalizeNVDHistoryChange(payload)
		if err != nil {
			return nvdHistoryPage{}, err
		}
		page.Changes = append(page.Changes, change)
	}
	sort.SliceStable(page.Changes, func(i, j int) bool {
		if page.Changes[i].ObservedAt.Equal(page.Changes[j].ObservedAt) {
			return page.Changes[i].SourceEventID < page.Changes[j].SourceEventID
		}
		return page.Changes[i].ObservedAt.Before(page.Changes[j].ObservedAt)
	})
	return page, nil
}

func normalizeNVDHistoryChange(payload models.JSONObject) (normalizedCVEHistoryChange, error) {
	core := payload
	if nested, ok := objectValue(payload["change"]); ok {
		core = nested
	}
	cveID := strings.ToUpper(firstString(core, "cveId", "cve_id", "vulnId", "vuln_id"))
	if cveID == "" {
		return normalizedCVEHistoryChange{}, fmt.Errorf("NVD CVE change has no CVE ID")
	}
	created, err := parseCVETime(firstString(core, "created", "createdAt", "created_at"))
	if err != nil {
		return normalizedCVEHistoryChange{}, fmt.Errorf("CVE %s has invalid change timestamp: %w", cveID, err)
	}
	eventID := firstString(core, "cveChangeId", "cve_change_id", "id")
	eventName := firstString(core, "eventName", "event_name", "event")
	if eventID == "" {
		eventID = cveID + ":" + created.UTC().Format(time.RFC3339Nano) + ":" + eventName
	}
	details := jsonObjectSlice(core["details"])
	before := models.JSONObject{}
	after := models.JSONObject{}
	for _, detail := range details {
		key := firstString(detail, "type", "field", "name", "action")
		if key == "" {
			key = "detail_" + strconv.Itoa(len(before)+len(after))
		}
		if value, ok := detail["oldValue"]; ok {
			before[key] = value
		} else if value, ok := detail["old_value"]; ok {
			before[key] = value
		}
		if value, ok := detail["newValue"]; ok {
			after[key] = value
		} else if value, ok := detail["new_value"]; ok {
			after[key] = value
		}
	}
	return normalizedCVEHistoryChange{
		CVEID:            cveID,
		EventName:        eventName,
		SourceEventID:    eventID,
		SourceIdentifier: firstString(core, "sourceIdentifier", "source_identifier"),
		ObservedAt:       created,
		Before:           before,
		After:            after,
		Details:          details,
		RawPayload:       payload,
	}, nil
}

func parseCVETime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, fmt.Errorf("timestamp is empty")
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.999", "2006-01-02T15:04:05"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("unsupported timestamp %q", value)
}

func (c *cveHistoryClient) fetchCurrentSnapshot(ctx context.Context, cveID string) (cveCurrentSnapshot, error) {
	if strings.TrimSpace(cveID) == "" {
		return cveCurrentSnapshot{}, fmt.Errorf("CVE ID is required")
	}
	var official models.JSONObject
	officialEndpoint := strings.TrimRight(c.officialCVEBaseURL, "/") + "/" + url.PathEscape(cveID)
	if err := c.getJSON(ctx, officialEndpoint, &official); err != nil {
		return cveCurrentSnapshot{}, fmt.Errorf("fetch official CVE %s: %w", cveID, err)
	}

	query := url.Values{}
	query.Set("cveId", cveID)
	var nvd models.JSONObject
	nvdEndpoint := strings.TrimRight(c.nvdCVEsBaseURL, "?") + "?" + query.Encode()
	if err := c.getJSON(ctx, nvdEndpoint, &nvd); err != nil {
		return cveCurrentSnapshot{}, fmt.Errorf("fetch NVD CVE %s: %w", cveID, err)
	}

	ranges := extractCVESAffectedRanges(official, nvd)
	state := deriveCurrentCVEState(official, nvd, ranges)
	severity, score, vector := extractCurrentCVSS(official, nvd)
	return cveCurrentSnapshot{
		CVEState:       state,
		Severity:       severity,
		CVSSScore:      score,
		CVSSVector:     vector,
		AffectedRanges: ranges,
		FixedVersions:  fixedVersionsFromRanges(ranges),
		RawOfficial:    official,
		RawNVD:         nvd,
	}, nil
}

func deriveCurrentCVEState(official, nvd models.JSONObject, ranges []models.JSONObject) string {
	officialState := strings.ToLower(strings.TrimSpace(nestedString(official, "cveMetadata", "state")))
	if officialState == "rejected" || strings.Contains(officialState, "reject") {
		return models.IntelligenceCVEStateRejected
	}
	if current := firstNVDCurrentCVE(nvd); current != nil {
		status := strings.ToLower(strings.TrimSpace(firstString(current, "vulnStatus", "vuln_status")))
		if strings.Contains(status, "reject") {
			return models.IntelligenceCVEStateRejected
		}
	}
	if nvdCVETagDisputed(nvd) || strings.Contains(officialState, "disput") {
		return models.IntelligenceCVEStateDisputed
	}
	if len(ranges) > 0 {
		return models.IntelligenceCVEStateAffected
	}
	return models.IntelligenceCVEStateUnknown
}

func extractCurrentCVSS(official, nvd models.JSONObject) (string, float64, string) {
	for _, metrics := range []models.JSONObject{nestedObject(firstNVDCurrentCVE(nvd), "metrics"), officialMetrics(official)} {
		if len(metrics) == 0 {
			continue
		}
		for _, key := range []string{"cvssMetricV40", "cvssMetricV4", "cvssMetricV31", "cvssMetricV30", "cvssMetricV3", "cvssMetricV2", "cvssV4_0", "cvssV3_1", "cvssV3_0", "cvssV2", "_official_metrics"} {
			for _, metric := range jsonObjectSlice(metrics[key]) {
				candidates := []models.JSONObject{metric}
				if key == "_official_metrics" {
					candidates = nil
					for _, cvssKey := range []string{"cvssV40", "cvssV4_0", "cvssV3_1", "cvssV3_0", "cvssV2"} {
						if candidate, ok := objectValue(metric[cvssKey]); ok {
							candidates = append(candidates, candidate)
						}
					}
				}
				for _, candidate := range candidates {
					data := nestedObject(candidate, "cvssData")
					if len(data) == 0 {
						data = candidate
					}
					score := numberValue(data["baseScore"])
					severity := normalizeSeverity(firstString(data, "baseSeverity", "severity"))
					vector := firstString(data, "vectorString", "vector")
					if score > 0 || severity != models.SeverityUnknown || vector != "" {
						return severity, score, vector
					}
				}
			}
		}
	}
	return models.SeverityUnknown, 0, ""
}

func extractCVESAffectedRanges(official, nvd models.JSONObject) []models.JSONObject {
	ranges := make([]models.JSONObject, 0)
	containers := nestedObject(official, "containers")
	if cna := nestedObject(containers, "cna"); len(cna) > 0 {
		ranges = append(ranges, affectedRangesFromContainer(cna, "official")...)
	}
	for _, adp := range jsonObjectSlice(containers["adp"]) {
		ranges = append(ranges, affectedRangesFromContainer(adp, "official")...)
	}
	if current := firstNVDCurrentCVE(nvd); current != nil {
		ranges = append(ranges, affectedRangesFromContainer(current, "nvd")...)
		configurations := jsonObjectSlice(current["configurations"])
		for _, configuration := range configurations {
			ranges = append(ranges, cpeRangesFromConfiguration(configuration)...)
		}
	}
	return deduplicateJSONObjectSlice(ranges)
}

func affectedRangesFromContainer(container models.JSONObject, source string) []models.JSONObject {
	ranges := make([]models.JSONObject, 0)
	for _, affected := range jsonObjectSlice(container["affected"]) {
		packageObject := nestedObject(affected, "package")
		packageName := firstString(packageObject, "name", "product", "package_name")
		if packageName == "" {
			packageName = firstString(affected, "product", "name", "package_name")
		}
		purl := firstString(packageObject, "purl", "package_url")
		if purl == "" {
			purl = firstString(affected, "purl", "package_url")
		}
		versions := jsonObjectSlice(affected["versions"])
		if len(versions) == 0 {
			ranges = append(ranges, normalizeAffectedRange(affected, packageName, purl, source))
			continue
		}
		for _, version := range versions {
			ranges = append(ranges, normalizeAffectedRange(version, packageName, purl, source))
		}
	}
	return ranges
}

func normalizeAffectedRange(raw models.JSONObject, packageName, purl, source string) models.JSONObject {
	rangeValue := models.JSONObject{}
	for _, key := range []string{"status", "introduced", "fixed", "changes", "version", "range", "exact", "less_than", "less_than_or_equal", "version_start_including", "version_start_excluding", "version_end_including", "version_end_excluding", "fixed_version", "version_type", "lessThan", "lessThanOrEqual", "versionStartIncluding", "versionStartExcluding", "versionEndIncluding", "versionEndExcluding", "fixedVersion", "versionType"} {
		if value, ok := raw[key]; ok {
			rangeValue[key] = value
		}
	}
	for sourceKey, targetKey := range map[string]string{
		"lessThan":              "less_than",
		"lessThanOrEqual":       "less_than_or_equal",
		"versionStartIncluding": "version_start_including",
		"versionStartExcluding": "version_start_excluding",
		"versionEndIncluding":   "version_end_including",
		"versionEndExcluding":   "version_end_excluding",
		"fixedVersion":          "fixed_version",
		"versionType":           "version_type",
	} {
		if value, ok := rangeValue[sourceKey]; ok {
			delete(rangeValue, sourceKey)
			rangeValue[targetKey] = value
		}
	}
	if rangeValue["version"] == nil && raw["range"] != nil {
		rangeValue["version"] = raw["range"]
	}
	if packageName != "" {
		rangeValue["package_name"] = packageName
	}
	if purl != "" {
		rangeValue["purl"] = purl
		rangeValue["identity_kind"] = "purl"
	} else if packageName != "" {
		rangeValue["identity_kind"] = "package_name"
	}
	rangeValue["source"] = source
	rangeValue["raw"] = raw
	return rangeValue
}

func cpeRangesFromConfiguration(configuration models.JSONObject) []models.JSONObject {
	ranges := make([]models.JSONObject, 0)
	var visit func(models.JSONObject)
	visit = func(node models.JSONObject) {
		for _, match := range jsonObjectSlice(node["cpeMatch"]) {
			rangeValue := models.JSONObject{
				"identity_kind": "cpe",
				"cpe":           firstString(match, "criteria", "cpe23Uri"),
				"status":        "affected",
				"source":        "nvd",
				"raw":           match,
			}
			if vulnerable, ok := match["vulnerable"].(bool); ok && !vulnerable {
				rangeValue["status"] = "unaffected"
			}
			for sourceKey, targetKey := range map[string]string{
				"versionStartIncluding": "version_start_including",
				"versionStartExcluding": "version_start_excluding",
				"versionEndIncluding":   "version_end_including",
				"versionEndExcluding":   "version_end_excluding",
			} {
				if value, ok := match[sourceKey]; ok {
					rangeValue[targetKey] = value
				}
			}
			ranges = append(ranges, rangeValue)
		}
		for _, child := range jsonObjectSlice(node["children"]) {
			visit(child)
		}
		for _, child := range jsonObjectSlice(node["nodes"]) {
			visit(child)
		}
	}
	visit(configuration)
	return ranges
}

func fixedVersionsFromRanges(ranges []models.JSONObject) []string {
	versions := make([]string, 0)
	seen := make(map[string]bool)
	for _, rawRange := range ranges {
		for _, key := range []string{"fixed", "fixed_version", "less_than", "less_than_or_equal", "version_end_excluding", "version_end_including"} {
			if value := firstString(rawRange, key); value != "" && !seen[value] {
				seen[value] = true
				versions = append(versions, value)
			}
		}
		for _, change := range jsonObjectSlice(rawRange["changes"]) {
			if strings.EqualFold(firstString(change, "status"), "unaffected") {
				if value := firstString(change, "at"); value != "" && !seen[value] {
					seen[value] = true
					versions = append(versions, value)
				}
			}
		}
	}
	sort.Strings(versions)
	return versions
}

func nvdCVETagDisputed(nvd models.JSONObject) bool {
	current := firstNVDCurrentCVE(nvd)
	if current == nil {
		return false
	}
	for _, tag := range jsonObjectSlice(current["cveTags"]) {
		if strings.Contains(strings.ToLower(firstString(tag, "tags", "tag", "name")), "disput") {
			return true
		}
	}
	return strings.Contains(strings.ToLower(fmt.Sprint(current["cveTags"])), "disput")
}

func firstNVDCurrentCVE(nvd models.JSONObject) models.JSONObject {
	vulnerabilities := jsonObjectSlice(nvd["vulnerabilities"])
	if len(vulnerabilities) == 0 {
		return nil
	}
	return nestedObject(vulnerabilities[0], "cve")
}

func officialMetrics(official models.JSONObject) models.JSONObject {
	containers := nestedObject(official, "containers")
	metrics := models.JSONObject{}
	if cna := nestedObject(containers, "cna"); len(cna) > 0 {
		if object, ok := objectValue(cna["metrics"]); ok {
			metrics = object
		} else if values := jsonObjectSlice(cna["metrics"]); len(values) > 0 {
			metrics["_official_metrics"] = values
		}
	}
	return metrics
}

func nestedObject(values map[string]any, keys ...string) models.JSONObject {
	current := models.JSONObject(values)
	for _, key := range keys {
		var ok bool
		current, ok = objectValue(current[key])
		if !ok {
			return nil
		}
	}
	return current
}

func nestedString(values models.JSONObject, keys ...string) string {
	if len(keys) == 0 {
		return ""
	}
	parent := nestedObject(values, keys[:len(keys)-1]...)
	return firstString(parent, keys[len(keys)-1])
}

func objectValue(value any) (models.JSONObject, bool) {
	switch typed := value.(type) {
	case map[string]any:
		return models.JSONObject(typed), true
	case models.JSONObject:
		return typed, true
	default:
		return nil, false
	}
}

func jsonObjectSlice(value any) []models.JSONObject {
	items, ok := value.([]any)
	if !ok {
		if typed, ok := value.([]models.JSONObject); ok {
			return typed
		}
		return nil
	}
	result := make([]models.JSONObject, 0, len(items))
	for _, item := range items {
		if object, ok := objectValue(item); ok {
			result = append(result, object)
		}
	}
	return result
}

func rawJSONObject(raw json.RawMessage) (models.JSONObject, error) {
	var object models.JSONObject
	if err := json.Unmarshal(raw, &object); err != nil {
		return nil, err
	}
	return object, nil
}

func deduplicateJSONObjectSlice(values []models.JSONObject) []models.JSONObject {
	result := make([]models.JSONObject, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		encoded, err := json.Marshal(value)
		if err != nil {
			result = append(result, value)
			continue
		}
		key := string(encoded)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, value)
	}
	return result
}

func numberValue(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case json.Number:
		parsed, _ := typed.Float64()
		return parsed
	case string:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed
	default:
		return 0
	}
}

// SyncCVEHistory polls NVD change history and re-evaluates each successfully
// normalized event against the official CVE record and current NVD record.
// It is intentionally exported so deployments and tests can run one bounded
// synchronization cycle without starting the worker scheduler.
func SyncCVEHistory(ctx context.Context, db *bun.DB) error {
	return runCVEHistorySync(ctx, db, newCVEHistoryClient(), "manual")
}

func syncCVEHistoryWithClient(ctx context.Context, db *bun.DB, client *cveHistoryClient) error {
	if db == nil {
		return fmt.Errorf("database is required")
	}
	if client == nil {
		client = newCVEHistoryClient()
	}
	now := time.Now().UTC()
	checkpoint, err := ensureCVEHistoryCheckpoint(ctx, db, now)
	if err != nil {
		return err
	}
	if checkpoint.NextRetryAt != nil && checkpoint.NextRetryAt.After(now) {
		return nil
	}
	updateCVEHistorySyncProgress(func(progress *CVEHistorySyncProgress) {
		progress.Phase = "fetching_history"
		progress.CurrentVulnID = ""
	})

	checkpoint.LastAttemptAt = &now
	checkpoint.UpdatedAt = now
	if _, err := db.NewUpdate().Model(checkpoint).Column("last_attempt_at", "updated_at").Where("source = ?", cveHistorySource).Exec(ctx); err != nil {
		return fmt.Errorf("mark CVE history sync attempt: %w", err)
	}

	runContext := newCVEHistoryRunContext(client)
	if err := syncCVEHistoryWindows(ctx, db, runContext, checkpoint, now); err != nil {
		return markCVEHistorySyncFailure(ctx, db, checkpoint, err, now)
	}
	updateCVEHistorySyncProgress(func(progress *CVEHistorySyncProgress) {
		progress.Phase = "finalizing"
		progress.CurrentVulnID = ""
	})
	checkpoint.LastSuccessAt = &now
	checkpoint.NextRetryAt = nil
	checkpoint.ConsecutiveFailures = 0
	checkpoint.LastError = ""
	checkpoint.UpdatedAt = now
	if _, err := db.NewUpdate().Model(checkpoint).Column("last_success_at", "next_retry_at", "consecutive_failures", "last_error", "updated_at").Where("source = ?", cveHistorySource).Exec(ctx); err != nil {
		return fmt.Errorf("mark CVE history sync success: %w", err)
	}
	return nil
}

func ensureCVEHistoryCheckpoint(ctx context.Context, db *bun.DB, now time.Time) (*models.VulnerabilityIntelligenceSyncCheckpoint, error) {
	checkpoint := &models.VulnerabilityIntelligenceSyncCheckpoint{}
	err := db.NewSelect().Model(checkpoint).Where("source = ?", cveHistorySource).Scan(ctx)
	if err == nil {
		return checkpoint, nil
	}
	if err != sql.ErrNoRows {
		return nil, fmt.Errorf("load CVE history checkpoint: %w", err)
	}
	lookback := 24 * time.Hour
	if config.Config != nil && config.Config.VulnKB.CVEHistoryInitialLookbackHours > 0 {
		lookback = time.Duration(config.Config.VulnKB.CVEHistoryInitialLookbackHours) * time.Hour
	}
	if lookback > maxNVDHistoryWindow {
		lookback = maxNVDHistoryWindow
	}
	checkpoint = &models.VulnerabilityIntelligenceSyncCheckpoint{
		Source:        cveHistorySource,
		CursorAt:      now.Add(-lookback),
		CursorEventID: "",
		UpdatedAt:     now,
	}
	if _, err := db.NewInsert().Model(checkpoint).On("CONFLICT (source) DO NOTHING").Exec(ctx); err != nil {
		return nil, fmt.Errorf("create CVE history checkpoint: %w", err)
	}
	if err := db.NewSelect().Model(checkpoint).Where("source = ?", cveHistorySource).Scan(ctx); err != nil {
		return nil, fmt.Errorf("load created CVE history checkpoint: %w", err)
	}
	return checkpoint, nil
}

func syncCVEHistoryWindows(ctx context.Context, db *bun.DB, runContext *cveHistoryRunContext, checkpoint *models.VulnerabilityIntelligenceSyncCheckpoint, now time.Time) error {
	windowStart := checkpoint.CursorAt
	if windowStart.IsZero() {
		windowStart = now.Add(-24 * time.Hour)
	}
	for windowStart.Before(now) {
		windowEnd := windowStart.Add(maxNVDHistoryWindow)
		if windowEnd.After(now) {
			windowEnd = now
		}
		startIndex := 0
		for {
			updateCVEHistorySyncProgress(func(progress *CVEHistorySyncProgress) {
				progress.Phase = "fetching_history"
				progress.CurrentVulnID = ""
			})
			page, err := runContext.client.fetchHistoryPage(ctx, windowStart, windowEnd, startIndex)
			if err != nil {
				return err
			}
			if startIndex == 0 {
				updateCVEHistorySyncProgress(func(progress *CVEHistorySyncProgress) {
					progress.EventsTotal += page.TotalResults
				})
			}
			updateCVEHistorySyncProgress(func(progress *CVEHistorySyncProgress) {
				progress.Phase = "processing_events"
			})
			for _, change := range page.Changes {
				updateCVEHistorySyncProgress(func(progress *CVEHistorySyncProgress) {
					progress.CurrentVulnID = change.CVEID
				})
				if cveHistoryCursorAtOrAfter(checkpoint, change) {
					completeCVEHistoryEventProgress()
					continue
				}
				if err := processCVEHistoryChange(ctx, db, runContext, change); err != nil {
					failCVEHistoryEventProgress()
					return err
				}
				checkpoint.CursorAt = change.ObservedAt
				checkpoint.CursorEventID = change.SourceEventID
				if err := persistCVEHistoryCursor(ctx, db, checkpoint); err != nil {
					return err
				}
				completeCVEHistoryEventProgress()
			}

			pageSize := page.ResultsPerPage
			if pageSize <= 0 {
				pageSize = len(page.Changes)
			}
			startIndex += len(page.Changes)
			if len(page.Changes) == 0 || page.TotalResults <= startIndex || len(page.Changes) < pageSize {
				break
			}
		}
		if checkpoint.CursorAt.Before(windowEnd) {
			checkpoint.CursorAt = windowEnd
			checkpoint.CursorEventID = ""
			if err := persistCVEHistoryCursor(ctx, db, checkpoint); err != nil {
				return err
			}
		}
		windowStart = windowEnd
	}
	return nil
}

func cveHistoryCursorAtOrAfter(checkpoint *models.VulnerabilityIntelligenceSyncCheckpoint, change normalizedCVEHistoryChange) bool {
	if change.ObservedAt.Before(checkpoint.CursorAt) {
		return true
	}
	if change.ObservedAt.After(checkpoint.CursorAt) {
		return false
	}
	return change.SourceEventID <= checkpoint.CursorEventID
}

func processCVEHistoryChange(ctx context.Context, db *bun.DB, runContext *cveHistoryRunContext, change normalizedCVEHistoryChange) error {
	event, err := persistCVEHistoryChange(ctx, db, change)
	if err != nil {
		return err
	}
	if event.ProcessedAt != nil {
		return nil
	}

	snapshot, err := runContext.fetchCurrentSnapshot(ctx, event.VulnID)
	if err != nil {
		return markCVEHistoryEventError(ctx, db, event.ID, err)
	}
	_, err = IngestIntelligence(ctx, db, IntelligenceIngestRequest{
		Source:         "nvd",
		Version:        "cve-history:" + event.SourceEventID,
		FeedObservedAt: &event.ObservedAt,
		Metadata: models.JSONObject{
			"change_event_id":   event.ID.String(),
			"event_name":        event.EventName,
			"source_identifier": event.SourceIdentifier,
		},
		Records: []IntelligenceIngestRecord{{
			VulnID:         event.VulnID,
			Source:         "nvd",
			ObservedAt:     &event.ObservedAt,
			CVEState:       snapshot.CVEState,
			Severity:       snapshot.Severity,
			CVSSScore:      snapshot.CVSSScore,
			CVSSVector:     snapshot.CVSSVector,
			AffectedRanges: snapshot.AffectedRanges,
			FixedVersions:  snapshot.FixedVersions,
			RawEvidence:    models.JSONObject{"change_event": event.RawPayload, "official_cve": snapshot.RawOfficial, "nvd_cve": snapshot.RawNVD},
			ChangeEventID:  &event.ID,
		}},
	})
	if err != nil {
		return markCVEHistoryEventError(ctx, db, event.ID, err)
	}
	if _, err := db.NewUpdate().Model((*models.VulnerabilityIntelligenceChangeEvent)(nil)).
		Set("processed_at = ?", time.Now().UTC()).
		Set("processing_error = ''").
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ?", event.ID).Exec(ctx); err != nil {
		return fmt.Errorf("mark CVE history event %s processed: %w", event.ID, err)
	}
	return nil
}

func persistCVEHistoryChange(ctx context.Context, db *bun.DB, change normalizedCVEHistoryChange) (*models.VulnerabilityIntelligenceChangeEvent, error) {
	event := &models.VulnerabilityIntelligenceChangeEvent{
		Source:           cveHistorySource,
		SourceEventID:    change.SourceEventID,
		VulnID:           change.CVEID,
		EventName:        change.EventName,
		SourceIdentifier: change.SourceIdentifier,
		ObservedAt:       change.ObservedAt,
		Before:           change.Before,
		After:            change.After,
		Details:          change.Details,
		RawPayload:       change.RawPayload,
	}
	if _, err := db.NewInsert().Model(event).On("CONFLICT (source, source_event_id) DO NOTHING").Exec(ctx); err != nil {
		return nil, fmt.Errorf("persist CVE history event %s: %w", change.SourceEventID, err)
	}
	persisted := &models.VulnerabilityIntelligenceChangeEvent{}
	if err := db.NewSelect().Model(persisted).Where("source = ? AND source_event_id = ?", cveHistorySource, change.SourceEventID).Scan(ctx); err != nil {
		return nil, fmt.Errorf("load CVE history event %s: %w", change.SourceEventID, err)
	}
	return persisted, nil
}

func markCVEHistoryEventError(ctx context.Context, db *bun.DB, eventID uuid.UUID, eventErr error) error {
	message := eventErr.Error()
	if _, err := db.NewUpdate().Model((*models.VulnerabilityIntelligenceChangeEvent)(nil)).
		Set("processing_error = ?", message).
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ?", eventID).Exec(ctx); err != nil {
		return fmt.Errorf("record CVE history event %s failure: %v (and update failed: %w)", eventID, eventErr, err)
	}
	return eventErr
}

func persistCVEHistoryCursor(ctx context.Context, db *bun.DB, checkpoint *models.VulnerabilityIntelligenceSyncCheckpoint) error {
	checkpoint.UpdatedAt = time.Now().UTC()
	if _, err := db.NewUpdate().Model(checkpoint).Column("cursor_at", "cursor_event_id", "updated_at").Where("source = ?", cveHistorySource).Exec(ctx); err != nil {
		return fmt.Errorf("persist CVE history cursor: %w", err)
	}
	return nil
}

func markCVEHistorySyncFailure(ctx context.Context, db *bun.DB, checkpoint *models.VulnerabilityIntelligenceSyncCheckpoint, syncErr error, now time.Time) error {
	checkpoint.ConsecutiveFailures++
	checkpoint.LastError = syncErr.Error()
	checkpoint.NextRetryAt = timePtr(now.Add(retryDelay(checkpoint.ConsecutiveFailures-1, retryAfterFromError(syncErr))))
	checkpoint.UpdatedAt = now
	if _, err := db.NewUpdate().Model(checkpoint).Column("consecutive_failures", "last_error", "next_retry_at", "updated_at").Where("source = ?", cveHistorySource).Exec(ctx); err != nil {
		return fmt.Errorf("CVE history sync failed: %v (and checkpoint update failed: %w)", syncErr, err)
	}
	return syncErr
}

func retryAfterFromError(err error) time.Duration {
	var httpErr *cveHistoryHTTPError
	if errors.As(err, &httpErr) {
		return httpErr.RetryAfter
	}
	return 0
}

func timePtr(value time.Time) *time.Time {
	return &value
}

// StartCVEHistorySync starts one non-blocking poller when the feature is
// enabled. Feed outages are logged and retried; they never stop scan workers.
func StartCVEHistorySync(db *bun.DB) {
	if db == nil || !CVEHistoryEnabled() {
		return
	}
	interval := time.Duration(config.Config.VulnKB.CVEHistoryIntervalMinutes) * time.Minute
	if interval <= 0 {
		interval = 120 * time.Minute
	}
	go func() {
		client := newCVEHistoryClient()
		if err := SyncCVEHistoryWithClient(context.Background(), db, client); err != nil {
			log.Warnf("CVE history sync failed: %v", err)
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			if err := SyncCVEHistoryWithClient(context.Background(), db, client); err != nil {
				log.Warnf("CVE history sync failed: %v", err)
			}
		}
	}()
}

// SyncCVEHistoryWithClient is the injectable form used by focused tests and
// by the scheduler. The public SyncCVEHistory uses production defaults.
func SyncCVEHistoryWithClient(ctx context.Context, db *bun.DB, client *cveHistoryClient) error {
	return runCVEHistorySync(ctx, db, client, "scheduler")
}

// QueueCVEHistorySync schedules one operator-triggered synchronization. It
// returns false when the feature is disabled or another sync is already in
// progress.
func QueueCVEHistorySync(db *bun.DB) bool {
	if db == nil || !CVEHistoryEnabled() {
		return false
	}
	startedAt, ok := beginCVEHistorySync()
	if !ok {
		return false
	}
	go func() {
		defer endCVEHistorySync()
		if err := performCVEHistorySync(context.Background(), db, newCVEHistoryClient(), "manual", startedAt); err != nil {
			log.Warnf("manual CVE history sync failed: %v", err)
		}
	}()
	return true
}

func CVEHistoryEnabled() bool {
	return config.Config != nil && config.Config.VulnKB.CVEHistoryEnabled
}

func CVEHistoryIntervalMinutes() int {
	if config.Config == nil || config.Config.VulnKB.CVEHistoryIntervalMinutes <= 0 {
		return 120
	}
	return config.Config.VulnKB.CVEHistoryIntervalMinutes
}

func CurrentCVEHistorySyncStatus() CVEHistorySyncStatus {
	cveHistoryRunState.mu.Lock()
	defer cveHistoryRunState.mu.Unlock()
	var startedAt *time.Time
	if cveHistoryRunState.startedAt != nil {
		value := *cveHistoryRunState.startedAt
		startedAt = &value
	}
	progress := cveHistoryRunState.progress
	if progress.LastProgressAt != nil {
		value := *progress.LastProgressAt
		progress.LastProgressAt = &value
	}
	return CVEHistorySyncStatus{Running: cveHistoryRunState.running, StartedAt: startedAt, Progress: progress}
}

func updateCVEHistorySyncProgress(update func(*CVEHistorySyncProgress)) {
	cveHistoryRunState.mu.Lock()
	defer cveHistoryRunState.mu.Unlock()
	if !cveHistoryRunState.running {
		return
	}
	update(&cveHistoryRunState.progress)
	now := time.Now().UTC()
	cveHistoryRunState.progress.LastProgressAt = &now
}

func completeCVEHistoryEventProgress() {
	updateCVEHistorySyncProgress(func(progress *CVEHistorySyncProgress) {
		progress.EventsCompleted++
		progress.CurrentVulnID = ""
	})
}

func failCVEHistoryEventProgress() {
	updateCVEHistorySyncProgress(func(progress *CVEHistorySyncProgress) {
		progress.EventsFailed++
	})
}

func runCVEHistorySync(ctx context.Context, db *bun.DB, client *cveHistoryClient, trigger string) error {
	if db == nil {
		return fmt.Errorf("database is required")
	}
	startedAt, ok := beginCVEHistorySync()
	if !ok {
		return ErrCVEHistorySyncRunning
	}
	defer endCVEHistorySync()
	return performCVEHistorySync(ctx, db, client, trigger, startedAt)
}

func performCVEHistorySync(ctx context.Context, db *bun.DB, client *cveHistoryClient, trigger string, startedAt time.Time) error {
	run := &models.VulnerabilityIntelligenceSyncRun{
		Source:    cveHistorySource,
		Trigger:   trigger,
		Status:    "running",
		StartedAt: startedAt,
	}
	if _, err := db.NewInsert().Model(run).Exec(ctx); err != nil {
		return fmt.Errorf("create CVE history sync run: %w", err)
	}

	syncErr := syncCVEHistoryWithClient(ctx, db, client)
	completedAt := time.Now().UTC()
	run.CompletedAt = &completedAt
	if syncErr != nil {
		run.Status = "failed"
		run.Error = syncErr.Error()
	} else {
		run.Status = "success"
	}
	if _, err := db.NewUpdate().Model(run).
		Column("status", "completed_at", "error").
		Where("id = ?", run.ID).
		Exec(ctx); err != nil {
		if syncErr != nil {
			return fmt.Errorf("CVE history sync failed: %v (and run update failed: %w)", syncErr, err)
		}
		return fmt.Errorf("complete CVE history sync run: %w", err)
	}
	return syncErr
}

func beginCVEHistorySync() (time.Time, bool) {
	cveHistoryRunState.mu.Lock()
	defer cveHistoryRunState.mu.Unlock()
	if cveHistoryRunState.running {
		return time.Time{}, false
	}
	startedAt := time.Now().UTC()
	cveHistoryRunState.running = true
	cveHistoryRunState.startedAt = &startedAt
	cveHistoryRunState.progress = CVEHistorySyncProgress{
		Phase:          "starting",
		LastProgressAt: &startedAt,
	}
	return startedAt, true
}

func endCVEHistorySync() {
	cveHistoryRunState.mu.Lock()
	defer cveHistoryRunState.mu.Unlock()
	cveHistoryRunState.running = false
	cveHistoryRunState.startedAt = nil
	cveHistoryRunState.progress = CVEHistorySyncProgress{}
}
