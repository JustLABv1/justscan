package scans

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"justscan-backend/functions/authz"
	collectionhandlers "justscan-backend/handlers/collections"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// ArtifactSummary is the latest visible scan for one image name and tag pair.
// ScanCount deliberately covers the pair's complete visible history, while the
// remaining fields describe its newest scan.
type ArtifactSummary struct {
	ImageName            string                        `json:"image_name"`
	ImageTag             string                        `json:"image_tag"`
	ScanCount            int                           `json:"scan_count"`
	LatestScanID         string                        `json:"latest_scan_id"`
	LatestStatus         string                        `json:"latest_status"`
	LatestExternalStatus string                        `json:"latest_external_status,omitempty"`
	LatestScanAt         time.Time                     `json:"latest_scan_at"`
	OwnerType            string                        `json:"owner_type,omitempty"`
	OwnerUserID          *uuid.UUID                    `json:"owner_user_id,omitempty"`
	OwnerOrgID           *uuid.UUID                    `json:"owner_org_id,omitempty"`
	CriticalCount        int                           `json:"critical_count"`
	HighCount            int                           `json:"high_count"`
	MediumCount          int                           `json:"medium_count"`
	LowCount             int                           `json:"low_count"`
	ComplianceSummary    *models.ScanComplianceSummary `json:"compliance_summary,omitempty"`
	Collections          []models.ScanCollection       `json:"collections,omitempty"`
}

// ArtifactFilterOptions describes only filters that can match at least one
// visible image tag in the current scope and search result.
type ArtifactFilterOptions struct {
	Statuses      []string `json:"statuses"`
	CollectionIDs []string `json:"collection_ids"`
	HasCritical   bool     `json:"has_critical"`
	HasPolicyFail bool     `json:"has_policy_fail"`
}

func artifactCollectionWhere(raw string) (string, []interface{}) {
	collectionID := strings.TrimSpace(raw)
	if collectionID == "" {
		return "1=1", nil
	}
	if collectionID == "__none__" {
		return "NOT EXISTS (SELECT 1 FROM scan_collection_memberships scm WHERE scm.scan_id::text = l.latest_scan_id)", nil
	}
	return "EXISTS (SELECT 1 FROM scan_collection_memberships scm WHERE scm.scan_id::text = l.latest_scan_id AND scm.collection_id = ?)", []interface{}{collectionID}
}

func artifactPolicyWhere(raw string, orgID uuid.UUID, scoped bool) (string, []interface{}) {
	if strings.TrimSpace(raw) != "fail" || !scoped {
		return "1=1", nil
	}

	return "EXISTS (SELECT 1 FROM compliance_results cr WHERE cr.scan_id::text = l.latest_scan_id AND cr.org_id = ? AND cr.status = 'fail')", []interface{}{orgID}
}

func loadArtifactFilterOptions(
	ctx context.Context,
	db *bun.DB,
	baseQuery string,
	baseArgs []interface{},
	orgID uuid.UUID,
	orgScoped bool,
) (ArtifactFilterOptions, error) {
	options := ArtifactFilterOptions{Statuses: []string{}, CollectionIDs: []string{}}

	rows, err := db.QueryContext(ctx, baseQuery+`
SELECT l.latest_status, l.latest_external_status, l.critical_count
FROM latest l`, baseArgs...)
	if err != nil {
		return options, err
	}
	defer rows.Close()

	statuses := make(map[string]struct{})
	for rows.Next() {
		var status, externalStatus string
		var criticalCount int
		if err := rows.Scan(&status, &externalStatus, &criticalCount); err != nil {
			return options, err
		}
		if status != "" {
			statuses[status] = struct{}{}
		}
		if externalStatus != "" {
			statuses[externalStatus] = struct{}{}
		}
		options.HasCritical = options.HasCritical || criticalCount > 0
	}
	if err := rows.Err(); err != nil {
		return options, err
	}
	for status := range statuses {
		options.Statuses = append(options.Statuses, status)
	}
	sort.Strings(options.Statuses)

	collectionRows, err := db.QueryContext(ctx, baseQuery+`
SELECT DISTINCT scm.collection_id::text
FROM latest l
JOIN scan_collection_memberships scm ON scm.scan_id::text = l.latest_scan_id`, baseArgs...)
	if err != nil {
		return options, err
	}
	defer collectionRows.Close()
	for collectionRows.Next() {
		var collectionID string
		if err := collectionRows.Scan(&collectionID); err != nil {
			return options, err
		}
		options.CollectionIDs = append(options.CollectionIDs, collectionID)
	}
	if err := collectionRows.Err(); err != nil {
		return options, err
	}
	sort.Strings(options.CollectionIDs)

	if !orgScoped {
		return options, nil
	}
	if err := db.QueryRowContext(ctx, baseQuery+`
SELECT EXISTS (
    SELECT 1
    FROM latest l
    JOIN compliance_results cr ON cr.scan_id::text = l.latest_scan_id
    WHERE cr.org_id = ? AND cr.status = 'fail'
)`, append(append([]interface{}{}, baseArgs...), orgID)...).Scan(&options.HasPolicyFail); err != nil {
		return options, err
	}

	return options, nil
}

// ListScanArtifacts returns one current row per image name and tag pair.
// Filters describe the latest scan for the pair, never an arbitrary historical run.
func ListScanArtifacts(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}

		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "30"))
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 100 {
			limit = 30
		}
		offset := (page - 1) * limit

		userWhere, userArgs := scanOwnershipWhere(userID, isAdmin, accessibleOrgIDs, "s")
		scopeWhere, scopeArgs := scanScopeWhere(c, userID, "s")
		searchWhere := "1=1"
		var searchArgs []interface{}
		if query := strings.TrimSpace(c.Query("q")); query != "" {
			pattern := "%" + query + "%"
			searchWhere = "(s.image_name ILIKE ? OR s.image_tag ILIKE ? OR (s.image_name || ':' || s.image_tag) ILIKE ?)"
			searchArgs = []interface{}{pattern, pattern, pattern}
		}

		baseArgs := append([]interface{}{}, userArgs...)
		baseArgs = append(baseArgs, scopeArgs...)
		baseArgs = append(baseArgs, searchArgs...)
		latestStatusWhere, latestStatusArgs := latestImageStatusWhereClause(c.Query("status"))
		criticalWhere := "1=1"
		switch strings.TrimSpace(c.Query("critical")) {
		case "yes":
			criticalWhere = "l.critical_count > 0"
		case "no":
			criticalWhere = "l.critical_count = 0"
		}
		collectionWhere, collectionArgs := artifactCollectionWhere(c.Query("collection"))
		scopedOrgID, orgScoped := scopedOrgIDFromRequest(c)
		policyWhere, policyArgs := artifactPolicyWhere(c.Query("policy"), scopedOrgID, orgScoped)

		baseQuery := `
WITH ranked AS (
    SELECT
        s.image_name,
        s.image_tag,
        s.id::text AS latest_scan_id,
        s.status AS latest_status,
        COALESCE(s.external_status, '') AS latest_external_status,
        s.created_at AS latest_scan_at,
        s.owner_type,
        s.owner_user_id,
        s.owner_org_id,
        s.critical_count,
        s.high_count,
        s.medium_count,
        s.low_count,
        COUNT(*) OVER (PARTITION BY s.image_name, s.image_tag) AS scan_count,
        ROW_NUMBER() OVER (
            PARTITION BY s.image_name, s.image_tag
            ORDER BY s.created_at DESC, s.id DESC
        ) AS row_number
    FROM scans s
    WHERE ` + userWhere + ` AND ` + scopeWhere + ` AND ` + searchWhere + `
), latest AS (
    SELECT * FROM ranked WHERE row_number = 1
)
`

		filterOptions, err := loadArtifactFilterOptions(
			c.Request.Context(), db, baseQuery, baseArgs, scopedOrgID, orgScoped,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load artifact filter options"})
			return
		}

		countQuery := baseQuery + `
SELECT COUNT(*)
FROM latest l
WHERE ` + latestStatusWhere + ` AND ` + criticalWhere + ` AND ` + collectionWhere + ` AND ` + policyWhere
		countArgs := append([]interface{}{}, baseArgs...)
		countArgs = append(countArgs, latestStatusArgs...)
		countArgs = append(countArgs, collectionArgs...)
		countArgs = append(countArgs, policyArgs...)

		var total int
		if err := db.QueryRowContext(c.Request.Context(), countQuery, countArgs...).Scan(&total); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count scan artifacts"})
			return
		}

		dataQuery := baseQuery + `
SELECT
    l.image_name,
    l.image_tag,
    l.scan_count,
    l.latest_scan_id,
    l.latest_status,
    l.latest_external_status,
    l.latest_scan_at,
    l.owner_type,
    l.owner_user_id,
    l.owner_org_id,
    l.critical_count,
    l.high_count,
    l.medium_count,
    l.low_count
FROM latest l
WHERE ` + latestStatusWhere + ` AND ` + criticalWhere + ` AND ` + collectionWhere + ` AND ` + policyWhere + `
ORDER BY l.latest_scan_at DESC, l.latest_scan_id DESC
LIMIT ? OFFSET ?`
		dataArgs := append([]interface{}{}, baseArgs...)
		dataArgs = append(dataArgs, latestStatusArgs...)
		dataArgs = append(dataArgs, collectionArgs...)
		dataArgs = append(dataArgs, policyArgs...)
		dataArgs = append(dataArgs, limit, offset)

		rows, err := db.QueryContext(c.Request.Context(), dataQuery, dataArgs...)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan artifacts"})
			return
		}
		defer rows.Close()

		artifacts := make([]ArtifactSummary, 0)
		for rows.Next() {
			var artifact ArtifactSummary
			if err := rows.Scan(
				&artifact.ImageName,
				&artifact.ImageTag,
				&artifact.ScanCount,
				&artifact.LatestScanID,
				&artifact.LatestStatus,
				&artifact.LatestExternalStatus,
				&artifact.LatestScanAt,
				&artifact.OwnerType,
				&artifact.OwnerUserID,
				&artifact.OwnerOrgID,
				&artifact.CriticalCount,
				&artifact.HighCount,
				&artifact.MediumCount,
				&artifact.LowCount,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan artifact row"})
				return
			}
			artifacts = append(artifacts, artifact)
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read scan artifacts"})
			return
		}

		if len(artifacts) > 0 {
			scanIDs := make([]uuid.UUID, 0, len(artifacts))
			artifactIndexByScanID := make(map[uuid.UUID]int, len(artifacts))
			for index := range artifacts {
				scanID, parseErr := uuid.Parse(artifacts[index].LatestScanID)
				if parseErr != nil {
					continue
				}
				scanIDs = append(scanIDs, scanID)
				artifactIndexByScanID[scanID] = index
			}

			var memberships []models.ScanCollectionMembership
			if err := db.NewSelect().Model(&memberships).Where("scan_id IN (?)", bun.In(scanIDs)).Scan(c.Request.Context()); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load artifact collections"})
				return
			}
			collectionIDs := membershipCollectionIDs(memberships)
			collections, err := collectionhandlers.LoadCollectionsByIDs(c.Request.Context(), db, collectionIDs, userID, isAdmin, c.Query("scope"))
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load artifact collections"})
				return
			}
			collectionsByID := make(map[uuid.UUID]models.ScanCollection, len(collections))
			for _, collection := range collections {
				collectionsByID[collection.ID] = collection
			}
			for _, membership := range memberships {
				index, ok := artifactIndexByScanID[membership.ScanID]
				if !ok {
					continue
				}
				collection, ok := collectionsByID[membership.CollectionID]
				if ok {
					artifacts[index].Collections = append(artifacts[index].Collections, collection)
				}
			}
			for index := range artifacts {
				collectionhandlers.SortCollectionsForDisplay(artifacts[index].Collections)
			}

			if orgScoped {
				summaries, summaryErr := buildScanComplianceSummaries(c.Request.Context(), db, scanIDs, scopedOrgID)
				if summaryErr != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load artifact compliance summaries"})
					return
				}
				for scanID, summary := range summaries {
					if index, ok := artifactIndexByScanID[scanID]; ok {
						artifacts[index].ComplianceSummary = summary
					}
				}
			}
		}

		c.JSON(http.StatusOK, gin.H{"data": artifacts, "total": total, "page": page, "limit": limit, "filters": filterOptions})
	}
}

func membershipCollectionIDs(memberships []models.ScanCollectionMembership) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(memberships))
	seen := make(map[uuid.UUID]struct{}, len(memberships))
	for _, membership := range memberships {
		if _, ok := seen[membership.CollectionID]; ok {
			continue
		}
		seen[membership.CollectionID] = struct{}{}
		ids = append(ids, membership.CollectionID)
	}
	return ids
}
