package scans

import (
	"net/http"
	"strconv"
	"time"

	authfuncs "justscan-backend/functions/auth"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

// ImageSummary holds the aggregated view of all scans for a single image name.
type ImageSummary struct {
	ImageName     string    `json:"image_name"`
	ScanCount     int       `json:"scan_count"`
	LatestScanID  string    `json:"latest_scan_id"`
	LatestTag     string    `json:"latest_tag"`
	LatestStatus  string    `json:"latest_status"`
	LatestScanAt  time.Time `json:"latest_scan_at"`
	CriticalCount int       `json:"critical_count"`
	HighCount     int       `json:"high_count"`
	MediumCount   int       `json:"medium_count"`
	LowCount      int       `json:"low_count"`
}

// ListScanImages returns one summary row per distinct image name, ordered by most-recent scan.
func ListScanImages(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, err := authfuncs.ResolveUserAccess(c.GetHeader("Authorization"), db)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
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
		// Build WHERE clause fragments based on role and filter
		var userWhere string
		var userArgs []interface{}
		if !isAdmin {
			userWhere = "user_id = ?"
			userArgs = []interface{}{userID}
		} else {
			userWhere = "1=1"
		}

		imageWhere := "1=1"
		var imageArgs []interface{}
		if imageFilter != "" {
			imageWhere = "image_name ILIKE ?"
			imageArgs = []interface{}{"%" + imageFilter + "%"}
		}

		allArgs := append(userArgs, imageArgs...)

		// Count distinct image names
		countQuery := `SELECT COUNT(DISTINCT image_name) FROM scans WHERE ` + userWhere + ` AND ` + imageWhere
		var total int
		if err := db.QueryRowContext(c.Request.Context(), countQuery, allArgs...).Scan(&total); err != nil {
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
        created_at           AS latest_scan_at,
        critical_count,
        high_count,
        medium_count,
        low_count
    FROM scans
    WHERE ` + userWhere + ` AND ` + imageWhere + `
    ORDER BY image_name, created_at DESC
),
counts AS (
    SELECT image_name, COUNT(*) AS scan_count
    FROM scans
    WHERE ` + userWhere + ` AND ` + imageWhere + `
    GROUP BY image_name
)
SELECT
    l.image_name,
    c.scan_count,
    l.latest_scan_id,
    l.latest_tag,
    l.latest_status,
    l.latest_scan_at,
    l.critical_count,
    l.high_count,
    l.medium_count,
    l.low_count
FROM latest l
JOIN counts c ON c.image_name = l.image_name
ORDER BY l.latest_scan_at DESC
LIMIT ? OFFSET ?`

		// Each WHERE block uses the same args, so duplicate them for the two CTEs, then add pagination
		dataArgs := append(allArgs, allArgs...)
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
				&img.LatestScanAt,
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

		c.JSON(http.StatusOK, gin.H{"data": images, "total": total, "page": page, "limit": limit})
	}
}
