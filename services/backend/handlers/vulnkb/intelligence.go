package vulnkb

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type PublicVulnerabilityIntelligenceChangeEvent struct {
	ID               uuid.UUID           `json:"id"`
	Source           string              `json:"source"`
	SourceEventID    string              `json:"source_event_id"`
	VulnID           string              `json:"vuln_id"`
	EventName        string              `json:"event_name"`
	SourceIdentifier string              `json:"source_identifier"`
	ObservedAt       time.Time           `json:"observed_at"`
	Before           models.JSONObject   `json:"before"`
	After            models.JSONObject   `json:"after"`
	Details          []models.JSONObject `json:"details"`
	ProcessedAt      *time.Time          `json:"processed_at,omitempty"`
	CreatedAt        time.Time           `json:"created_at"`
	UpdatedAt        time.Time           `json:"updated_at"`
}

type PublicVulnerabilityIntelligenceHistoryResponse struct {
	Data         []PublicVulnerabilityIntelligenceChangeEvent `json:"data"`
	Total        int                                          `json:"total"`
	HasMore      bool                                         `json:"has_more"`
	NextBeforeAt *time.Time                                   `json:"next_before_at,omitempty"`
	NextBeforeID *uuid.UUID                                   `json:"next_before_id,omitempty"`
}

type VulnerabilityExposurePosture struct {
	State         string     `json:"state"`
	CVEState      string     `json:"cve_state"`
	Severity      string     `json:"severity"`
	CVSSScore     float64    `json:"cvss_score"`
	Reason        string     `json:"reason"`
	ObservedAt    *time.Time `json:"observed_at,omitempty"`
	ChangeEventID *uuid.UUID `json:"change_event_id,omitempty"`
	UpdatedAt     *time.Time `json:"updated_at,omitempty"`
}

type VulnerabilityExposureRow struct {
	FindingID        uuid.UUID                     `json:"finding_id"`
	ScanID           uuid.UUID                     `json:"scan_id"`
	ImageName        string                        `json:"image_name"`
	ImageTag         string                        `json:"image_tag"`
	CompletedAt      *time.Time                    `json:"completed_at,omitempty"`
	PackageName      string                        `json:"package_name"`
	InstalledVersion string                        `json:"installed_version"`
	FixedVersion     string                        `json:"fixed_version"`
	ScanSeverity     string                        `json:"scan_severity"`
	ScanCVSSScore    float64                       `json:"scan_cvss_score"`
	Posture          *VulnerabilityExposurePosture `json:"posture,omitempty"`
}

type VulnerabilityExposureSummary struct {
	Findings     int `json:"findings"`
	Scans        int `json:"scans"`
	Changed      int `json:"changed"`
	NeedsRescan  int `json:"needs_rescan"`
	FixAvailable int `json:"fix_available"`
}

type VulnerabilityExposureResponse struct {
	Data    []VulnerabilityExposureRow   `json:"data"`
	Total   int                          `json:"total"`
	Page    int                          `json:"page"`
	Limit   int                          `json:"limit"`
	HasMore bool                         `json:"has_more"`
	Summary VulnerabilityExposureSummary `json:"summary"`
}

type exposureQueryRow struct {
	FindingID            uuid.UUID  `bun:"finding_id"`
	ScanID               uuid.UUID  `bun:"scan_id"`
	ImageName            string     `bun:"image_name"`
	ImageTag             string     `bun:"image_tag"`
	CompletedAt          *time.Time `bun:"completed_at"`
	PackageName          string     `bun:"package_name"`
	InstalledVersion     string     `bun:"installed_version"`
	FixedVersion         string     `bun:"fixed_version"`
	ScanSeverity         string     `bun:"scan_severity"`
	ScanCVSSScore        float64    `bun:"scan_cvss_score"`
	PostureID            *uuid.UUID `bun:"posture_id"`
	PostureState         *string    `bun:"posture_state"`
	PostureCVEState      *string    `bun:"posture_cve_state"`
	PostureSeverity      *string    `bun:"posture_severity"`
	PostureCVSSScore     *float64   `bun:"posture_cvss_score"`
	PostureReason        *string    `bun:"posture_reason"`
	PostureObservedAt    *time.Time `bun:"posture_observed_at"`
	PostureChangeEventID *uuid.UUID `bun:"posture_change_event_id"`
	PostureUpdatedAt     *time.Time `bun:"posture_updated_at"`
}

func GetKBHistory(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		vulnID := strings.TrimSpace(c.Param("vulnId"))
		if vulnID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "vuln_id is required"})
			return
		}
		if !kbEntryExists(c, db, vulnID) {
			return
		}

		limit, err := historyLimit(c.Query("limit"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		beforeAt, beforeID, err := parsePublicHistoryCursor(c)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		countQuery := db.NewSelect().Model((*models.VulnerabilityIntelligenceChangeEvent)(nil)).
			Where("vuln_id = ?", vulnID)
		total, err := countQuery.Count(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count CVE history events"})
			return
		}

		var events []models.VulnerabilityIntelligenceChangeEvent
		eventQuery := db.NewSelect().Model(&events).
			Where("vuln_id = ?", vulnID).
			OrderExpr("observed_at DESC, id DESC").
			Limit(limit + 1)
		if beforeAt != nil && beforeID != nil {
			eventQuery.Where("(observed_at, id) < (?, ?)", *beforeAt, *beforeID)
		}
		if err := eventQuery.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load CVE history events"})
			return
		}

		hasMore := len(events) > limit
		var nextBeforeAt *time.Time
		var nextBeforeID *uuid.UUID
		if hasMore {
			last := events[limit-1]
			nextBeforeAt = &last.ObservedAt
			nextBeforeID = &last.ID
			events = events[:limit]
		}

		data := make([]PublicVulnerabilityIntelligenceChangeEvent, 0, len(events))
		for _, event := range events {
			data = append(data, PublicVulnerabilityIntelligenceChangeEvent{
				ID:               event.ID,
				Source:           event.Source,
				SourceEventID:    event.SourceEventID,
				VulnID:           event.VulnID,
				EventName:        event.EventName,
				SourceIdentifier: event.SourceIdentifier,
				ObservedAt:       event.ObservedAt,
				Before:           event.Before,
				After:            event.After,
				Details:          event.Details,
				ProcessedAt:      event.ProcessedAt,
				CreatedAt:        event.CreatedAt,
				UpdatedAt:        event.UpdatedAt,
			})
		}

		c.JSON(http.StatusOK, PublicVulnerabilityIntelligenceHistoryResponse{
			Data:         data,
			Total:        total,
			HasMore:      hasMore,
			NextBeforeAt: nextBeforeAt,
			NextBeforeID: nextBeforeID,
		})
	}
}

func GetKBExposure(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		vulnID := strings.TrimSpace(c.Param("vulnId"))
		if vulnID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "vuln_id is required"})
			return
		}
		if !kbEntryExists(c, db, vulnID) {
			return
		}

		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}
		postureFilter, err := normalizePostureFilter(c.Query("posture"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		page, limit := pageAndLimit(c)

		baseQuery := newExposureQuery(db, vulnID, userID, isAdmin, accessibleOrgIDs)
		applyPostureFilter(baseQuery, postureFilter)
		total, err := baseQuery.Count(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count authorized CVE exposure"})
			return
		}

		summaryQuery := newExposureQuery(db, vulnID, userID, isAdmin, accessibleOrgIDs)
		var summary VulnerabilityExposureSummary
		if err := summaryQuery.
			ColumnExpr("COUNT(DISTINCT v.id) AS findings").
			ColumnExpr("COUNT(DISTINCT v.scan_id) AS scans").
			ColumnExpr("COUNT(DISTINCT v.id) FILTER (WHERE p.state IS NOT NULL AND p.state <> ?) AS changed", models.PostureStateUnchanged).
			ColumnExpr("COUNT(DISTINCT v.id) FILTER (WHERE p.state = ?) AS needs_rescan", models.PostureStateNeedsRescan).
			ColumnExpr("COUNT(DISTINCT v.id) FILTER (WHERE p.state = ?) AS fix_available", models.PostureStateFixAvailable).
			Scan(c.Request.Context(), &summary); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to summarize authorized CVE exposure"})
			return
		}

		var rows []exposureQueryRow
		dataQuery := newExposureQuery(db, vulnID, userID, isAdmin, accessibleOrgIDs)
		applyPostureFilter(dataQuery, postureFilter)
		if err := dataQuery.
			ColumnExpr("v.id AS finding_id, v.scan_id, s.image_name, s.image_tag, s.completed_at, v.pkg_name AS package_name, v.installed_version, v.fixed_version, v.severity AS scan_severity, v.cvss_score AS scan_cvss_score").
			ColumnExpr("p.id AS posture_id, p.state AS posture_state, p.cve_state AS posture_cve_state, p.severity AS posture_severity, p.cvss_score AS posture_cvss_score, p.reason AS posture_reason, p.observed_at AS posture_observed_at, p.change_event_id AS posture_change_event_id, p.updated_at AS posture_updated_at").
			OrderExpr("s.completed_at DESC NULLS LAST, v.id DESC").
			Limit(limit).
			Offset((page-1)*limit).
			Scan(c.Request.Context(), &rows); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load authorized CVE exposure"})
			return
		}

		data := make([]VulnerabilityExposureRow, 0, len(rows))
		for _, row := range rows {
			item := VulnerabilityExposureRow{
				FindingID:        row.FindingID,
				ScanID:           row.ScanID,
				ImageName:        row.ImageName,
				ImageTag:         row.ImageTag,
				CompletedAt:      row.CompletedAt,
				PackageName:      row.PackageName,
				InstalledVersion: row.InstalledVersion,
				FixedVersion:     row.FixedVersion,
				ScanSeverity:     row.ScanSeverity,
				ScanCVSSScore:    row.ScanCVSSScore,
			}
			if row.PostureID != nil {
				posture := &VulnerabilityExposurePosture{
					State:         stringValue(row.PostureState),
					CVEState:      stringValue(row.PostureCVEState),
					Severity:      stringValue(row.PostureSeverity),
					CVSSScore:     floatValue(row.PostureCVSSScore),
					Reason:        stringValue(row.PostureReason),
					ObservedAt:    row.PostureObservedAt,
					ChangeEventID: row.PostureChangeEventID,
					UpdatedAt:     row.PostureUpdatedAt,
				}
				item.Posture = posture
			}
			data = append(data, item)
		}

		c.JSON(http.StatusOK, VulnerabilityExposureResponse{
			Data:    data,
			Total:   total,
			Page:    page,
			Limit:   limit,
			HasMore: page*limit < total,
			Summary: summary,
		})
	}
}

func kbEntryExists(c *gin.Context, db *bun.DB, vulnID string) bool {
	var entry models.VulnKBEntry
	if err := db.NewSelect().Model(&entry).Column("vuln_id").Where("vuln_id = ?", vulnID).Scan(c.Request.Context()); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "no KB entry found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load KB entry"})
		}
		return false
	}
	return true
}

func historyLimit(raw string) (int, error) {
	limit := 50
	if strings.TrimSpace(raw) != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			return 0, errors.New("history limit must be a number")
		}
		limit = parsed
	}
	if limit < 1 || limit > 100 {
		return 0, errors.New("history limit must be between 1 and 100")
	}
	return limit, nil
}

func parsePublicHistoryCursor(c *gin.Context) (*time.Time, *uuid.UUID, error) {
	rawBeforeAt := strings.TrimSpace(c.Query("before_at"))
	rawBeforeID := strings.TrimSpace(c.Query("before_id"))
	if rawBeforeAt == "" && rawBeforeID == "" {
		return nil, nil, nil
	}
	if rawBeforeAt == "" || rawBeforeID == "" {
		return nil, nil, errors.New("history cursor requires before_at and before_id")
	}
	beforeAt, err := time.Parse(time.RFC3339Nano, rawBeforeAt)
	if err != nil {
		return nil, nil, errors.New("history cursor before_at must be an RFC3339 timestamp")
	}
	beforeID, err := uuid.Parse(rawBeforeID)
	if err != nil {
		return nil, nil, errors.New("history cursor before_id must be a UUID")
	}
	return &beforeAt, &beforeID, nil
}

func pageAndLimit(c *gin.Context) (int, int) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "25"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 25
	}
	return page, limit
}

func normalizePostureFilter(raw string) (string, error) {
	filter := strings.ToLower(strings.TrimSpace(raw))
	switch filter {
	case "", "all", "changed", models.PostureStateNeedsRescan, models.PostureStateFixAvailable, models.PostureStateNotAffected, "disputed_rejected":
		return filter, nil
	default:
		return "", errors.New("unsupported posture filter")
	}
}

func newExposureQuery(db *bun.DB, vulnID string, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID) *bun.SelectQuery {
	query := db.NewSelect().
		TableExpr("vulnerabilities AS v").
		Join("JOIN scans AS s ON s.id = v.scan_id").
		Join("LEFT JOIN vulnerability_postures AS p ON p.finding_id = v.id").
		Where("v.vuln_id = ?", vulnID).
		Where("s.status = ?", models.ScanStatusCompleted)
	return authz.ApplyOwnershipVisibility(query, "s", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
}

func applyPostureFilter(query *bun.SelectQuery, filter string) {
	switch filter {
	case "changed":
		query.Where("p.state IS NOT NULL AND p.state <> ?", models.PostureStateUnchanged)
	case models.PostureStateNeedsRescan, models.PostureStateFixAvailable, models.PostureStateNotAffected:
		query.Where("p.state = ?", filter)
	case "disputed_rejected":
		query.Where("p.state IN (?)", bun.In([]string{models.PostureStateDisputed, models.PostureStateRejected}))
	}
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func floatValue(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}
