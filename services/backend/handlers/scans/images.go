package scans

import (
	"net/http"
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

// ImageSummary holds the aggregated view of all scans for a single image name.
type ImageSummary struct {
	ImageName            string                        `json:"image_name"`
	ScanCount            int                           `json:"scan_count"`
	LatestScanID         string                        `json:"latest_scan_id"`
	LatestTag            string                        `json:"latest_tag"`
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

func latestImageStatusWhereClause(raw string) (string, []interface{}) {
	statuses := strings.Split(raw, ",")
	clauses := make([]string, 0, len(statuses))
	args := make([]interface{}, 0, len(statuses)*2)

	for _, status := range statuses {
		status = strings.TrimSpace(status)
		if status == "" {
			continue
		}
		clauses = append(clauses, "(latest_status = ? OR latest_external_status = ?)")
		args = append(args, status, status)
	}

	if len(clauses) == 0 {
		return "1=1", nil
	}

	return "(" + strings.Join(clauses, " OR ") + ")", args
}

// ListScanImages returns one summary row per distinct image name, ordered by most-recent scan.
func ListScanImages(db *bun.DB) gin.HandlerFunc {
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

		imageFilter := c.Query("image")
		statusFilter := c.Query("status")
		// Build WHERE clause fragments based on role and filter
		userWhere, userArgs := scanOwnershipWhere(userID, isAdmin, accessibleOrgIDs, "scans")
		scopeWhere, scopeArgs := scanScopeWhere(c, userID, "scans")

		imageWhere := "1=1"
		var imageArgs []interface{}
		if imageFilter != "" {
			imageWhere = "image_name ILIKE ?"
			imageArgs = []interface{}{"%" + imageFilter + "%"}
		}
		collectionWhere := "1=1"
		var collectionArgs []interface{}
		if collectionID := strings.TrimSpace(c.Query("collection")); collectionID != "" {
			if collectionID == "__none__" {
				collectionWhere = "NOT EXISTS (SELECT 1 FROM scan_collection_memberships scm WHERE scm.scan_id = scans.id)"
			} else {
				collectionWhere = "id IN (SELECT scan_id FROM scan_collection_memberships WHERE collection_id = ?)"
				collectionArgs = []interface{}{collectionID}
			}
		}

		allArgs := append(userArgs, scopeArgs...)
		allArgs = append(allArgs, imageArgs...)
		allArgs = append(allArgs, collectionArgs...)
		latestStatusWhere, latestStatusArgs := latestImageStatusWhereClause(statusFilter)

		countQuery := `
WITH latest AS (
    SELECT DISTINCT ON (image_name)
        image_name,
        status               AS latest_status,
        COALESCE(external_status, '') AS latest_external_status
    FROM scans
    WHERE ` + userWhere + ` AND ` + scopeWhere + ` AND ` + imageWhere + ` AND ` + collectionWhere + `
    ORDER BY image_name, created_at DESC
)
SELECT COUNT(*) FROM latest WHERE ` + latestStatusWhere
		var total int
		countArgs := append(allArgs, latestStatusArgs...)
		if err := db.QueryRowContext(c.Request.Context(), countQuery, countArgs...).Scan(&total); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count images"})
			return
		}

		// Fetch per-image summaries using a CTE:
		// - DISTINCT ON (image_name) ordered by created_at DESC to get the latest scan's metadata
		// - A second CTE counts scans per image
		dataQuery := `
WITH latest AS (
    SELECT DISTINCT ON (image_name)
        image_name,
        id::text             AS latest_scan_id,
        image_tag            AS latest_tag,
        status               AS latest_status,
		COALESCE(external_status, '') AS latest_external_status,
        created_at           AS latest_scan_at,
		owner_type,
		owner_user_id,
		owner_org_id,
        critical_count,
        high_count,
        medium_count,
        low_count
    FROM scans
    WHERE ` + userWhere + ` AND ` + scopeWhere + ` AND ` + imageWhere + ` AND ` + collectionWhere + `
    ORDER BY image_name, created_at DESC
),
counts AS (
    SELECT image_name, COUNT(*) AS scan_count
    FROM scans
    WHERE ` + userWhere + ` AND ` + scopeWhere + ` AND ` + imageWhere + ` AND ` + collectionWhere + `
    GROUP BY image_name
)
SELECT
    l.image_name,
    c.scan_count,
    l.latest_scan_id,
    l.latest_tag,
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
JOIN counts c ON c.image_name = l.image_name
WHERE ` + latestStatusWhere + `
ORDER BY l.latest_scan_at DESC
LIMIT ? OFFSET ?`

		// The latest CTE and counts CTE share the same base args. The outer WHERE applies to latest status values only.
		dataArgs := append(allArgs, allArgs...)
		dataArgs = append(dataArgs, latestStatusArgs...)
		dataArgs = append(dataArgs, limit, offset)

		rows, err := db.QueryContext(c.Request.Context(), dataQuery, dataArgs...)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load images"})
			return
		}
		defer rows.Close()

		var images []ImageSummary
		for rows.Next() {
			var img ImageSummary
			if err := rows.Scan(
				&img.ImageName,
				&img.ScanCount,
				&img.LatestScanID,
				&img.LatestTag,
				&img.LatestStatus,
				&img.LatestExternalStatus,
				&img.LatestScanAt,
				&img.OwnerType,
				&img.OwnerUserID,
				&img.OwnerOrgID,
				&img.CriticalCount,
				&img.HighCount,
				&img.MediumCount,
				&img.LowCount,
			); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan image row"})
				return
			}
			images = append(images, img)
		}
		if images == nil {
			images = []ImageSummary{}
		}
		if len(images) > 0 {
			imageNames := make([]string, 0, len(images))
			imageIndexByName := make(map[string]int, len(images))
			for index, image := range images {
				imageNames = append(imageNames, image.ImageName)
				imageIndexByName[image.ImageName] = index
			}

			imageCollectionsUserWhere, imageCollectionsUserArgs := scanOwnershipWhere(userID, isAdmin, accessibleOrgIDs, "s")
			imageCollectionsScopeWhere, imageCollectionsScopeArgs := scanScopeWhere(c, userID, "s")
			imageCollectionsQuery := `
SELECT DISTINCT
	s.image_name,
	scm.collection_id
FROM scans s
JOIN scan_collection_memberships scm ON scm.scan_id = s.id
WHERE ` + imageCollectionsUserWhere + ` AND ` + imageCollectionsScopeWhere + ` AND s.image_name IN (?) AND ` + imageWhere + ` AND ` + collectionWhere

			imageCollectionArgs := append([]interface{}{}, imageCollectionsUserArgs...)
			imageCollectionArgs = append(imageCollectionArgs, imageCollectionsScopeArgs...)
			imageCollectionArgs = append(imageCollectionArgs, bun.In(imageNames))
			imageCollectionArgs = append(imageCollectionArgs, imageArgs...)
			imageCollectionArgs = append(imageCollectionArgs, collectionArgs...)

			type imageCollectionRow struct {
				ImageName    string    `bun:"image_name"`
				CollectionID uuid.UUID `bun:"collection_id"`
			}

			var rows []imageCollectionRow
			if err := db.NewRaw(imageCollectionsQuery, imageCollectionArgs...).Scan(c.Request.Context(), &rows); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load image collections"})
				return
			}

			collectionIDs := make([]uuid.UUID, 0, len(rows))
			for _, row := range rows {
				collectionIDs = append(collectionIDs, row.CollectionID)
			}
			collections, err := collectionhandlers.LoadCollectionsByIDs(c.Request.Context(), db, collectionIDs, userID, isAdmin, c.Query("scope"))
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load image collections"})
				return
			}
			collectionsByID := make(map[uuid.UUID]models.ScanCollection, len(collections))
			for _, collection := range collections {
				collectionsByID[collection.ID] = collection
			}

			for _, row := range rows {
				index, ok := imageIndexByName[row.ImageName]
				if !ok {
					continue
				}
				collection, ok := collectionsByID[row.CollectionID]
				if !ok {
					continue
				}
				alreadyPresent := false
				for _, existing := range images[index].Collections {
					if existing.ID == collection.ID {
						alreadyPresent = true
						break
					}
				}
				if !alreadyPresent {
					images[index].Collections = append(images[index].Collections, collection)
				}
			}
			for index := range images {
				if len(images[index].Collections) > 1 {
					collectionhandlers.SortCollectionsForDisplay(images[index].Collections)
				}
			}
		}

		if scopedOrgID, scoped := scopedOrgIDFromRequest(c); scoped {
			scanIDs := make([]uuid.UUID, 0, len(images))
			scanIndexByID := make(map[uuid.UUID]int, len(images))
			for index, image := range images {
				scanID, parseErr := uuid.Parse(strings.TrimSpace(image.LatestScanID))
				if parseErr != nil {
					continue
				}
				scanIDs = append(scanIDs, scanID)
				scanIndexByID[scanID] = index
			}
			summaries, summaryErr := buildScanComplianceSummaries(c.Request.Context(), db, scanIDs, scopedOrgID)
			if summaryErr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load image compliance summaries"})
				return
			}
			for scanID, summary := range summaries {
				index, ok := scanIndexByID[scanID]
				if !ok {
					continue
				}
				images[index].ComplianceSummary = summary
			}
		}

		c.JSON(http.StatusOK, gin.H{"data": images, "total": total, "page": page, "limit": limit})
	}
}

func scanOwnershipWhere(userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID, scanAlias string) (string, []interface{}) {
	if isAdmin {
		return "1=1", nil
	}

	idRef := qualifiedScanColumn(scanAlias, "id")

	clauses := []string{"user_id = ?", "owner_user_id = ?"}
	args := []interface{}{userID, userID}

	if len(accessibleOrgIDs) > 0 {
		ownerOrgPlaceholders := make([]string, len(accessibleOrgIDs))
		sharedOrgPlaceholders := make([]string, len(accessibleOrgIDs))
		for i, orgID := range accessibleOrgIDs {
			ownerOrgPlaceholders[i] = "?"
			sharedOrgPlaceholders[i] = "?"
			args = append(args, orgID)
		}
		for _, orgID := range accessibleOrgIDs {
			args = append(args, orgID)
		}
		clauses = append(clauses, "owner_org_id IN ("+strings.Join(ownerOrgPlaceholders, ",")+")")
		clauses = append(clauses, "EXISTS (SELECT 1 FROM org_scans os WHERE os.scan_id = "+idRef+" AND os.org_id IN ("+strings.Join(sharedOrgPlaceholders, ",")+"))")
	}

	return "(" + strings.Join(clauses, " OR ") + ")", args
}

func scanScopeWhere(c *gin.Context, userID uuid.UUID, scanAlias string) (string, []interface{}) {
	scope := c.Query("scope")
	if scope == "" {
		return "1=1", nil
	}
	if scope == "personal" {
		return "owner_user_id = ?", []interface{}{userID}
	}
	orgID, err := uuid.Parse(scope)
	if err != nil {
		return "1=1", nil
	}
	idRef := qualifiedScanColumn(scanAlias, "id")
	return "(owner_org_id = ? OR EXISTS (SELECT 1 FROM org_scans os2 WHERE os2.scan_id = " + idRef + " AND os2.org_id = ?))", []interface{}{orgID, orgID}
}

func qualifiedScanColumn(scanAlias, column string) string {
	alias := strings.TrimSpace(scanAlias)
	if alias == "" {
		alias = "scans"
	}
	return alias + "." + column
}
