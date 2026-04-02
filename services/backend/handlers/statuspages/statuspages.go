package statuspages

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"justscan-backend/functions/auth"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

var slugPattern = regexp.MustCompile(`[^a-z0-9]+`)

type statusPageTargetPayload struct {
	ImageName    string `json:"image_name"`
	ImageTag     string `json:"image_tag"`
	DisplayOrder int    `json:"display_order"`
}

type statusPageUpdatePayload struct {
	Title       string     `json:"title"`
	Body        string     `json:"body"`
	Level       string     `json:"level"`
	ActiveFrom  *time.Time `json:"active_from"`
	ActiveUntil *time.Time `json:"active_until"`
}

type statusPagePayload struct {
	Name            string                    `json:"name" binding:"required"`
	Slug            string                    `json:"slug"`
	Description     string                    `json:"description"`
	Visibility      string                    `json:"visibility" binding:"required"`
	IncludeAllTags  bool                      `json:"include_all_tags"`
	ImagePatterns   []string                  `json:"image_patterns"`
	StaleAfterHours int                       `json:"stale_after_hours"`
	Targets         []statusPageTargetPayload `json:"targets"`
	Updates         []statusPageUpdatePayload `json:"updates"`
}

type StatusPageItem struct {
	ImageName             string     `json:"image_name"`
	ImageTag              string     `json:"image_tag"`
	LatestScanID          string     `json:"latest_scan_id"`
	ScanStatus            string     `json:"scan_status"`
	Status                string     `json:"status"`
	ErrorMessage          string     `json:"error_message,omitempty"`
	CriticalCount         int        `json:"critical_count"`
	HighCount             int        `json:"high_count"`
	MediumCount           int        `json:"medium_count"`
	LowCount              int        `json:"low_count"`
	PreviousCriticalCount *int       `json:"previous_critical_count,omitempty"`
	PreviousHighCount     *int       `json:"previous_high_count,omitempty"`
	PreviousMediumCount   *int       `json:"previous_medium_count,omitempty"`
	PreviousLowCount      *int       `json:"previous_low_count,omitempty"`
	FreshnessHours        int64      `json:"freshness_hours"`
	ObservedAt            time.Time  `json:"observed_at"`
	PreviousScanAt        *time.Time `json:"previous_scan_at,omitempty"`
	DisplayOrder          int        `json:"display_order"`
	DeltaCriticalCount    *int       `json:"delta_critical_count,omitempty"`
	DeltaHighCount        *int       `json:"delta_high_count,omitempty"`
	DeltaMediumCount      *int       `json:"delta_medium_count,omitempty"`
	DeltaLowCount         *int       `json:"delta_low_count,omitempty"`
}

type statusPageResponse struct {
	Page  *models.StatusPage        `json:"page"`
	Items []StatusPageItem          `json:"items"`
	Info  map[string]any            `json:"info,omitempty"`
	Meta  map[string]int64          `json:"meta,omitempty"`
	Now   time.Time                 `json:"now"`
	Links map[string]string         `json:"links,omitempty"`
	Extra map[string][]string       `json:"extra,omitempty"`
	Flags map[string]bool           `json:"flags,omitempty"`
	Stats map[string]map[string]int `json:"stats,omitempty"`
}

func ListStatusPages(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, tokenType, ok := requireAuthContext(c)
		if !ok {
			return
		}

		var pages []models.StatusPage
		q := db.NewSelect().Model(&pages).OrderExpr("updated_at DESC")
		if tokenType != "admin" {
			q = q.Where("owner_user_id = ?", userID)
		}
		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list status pages"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": pages})
	}
}

func CreateStatusPage(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _, ok := requireAuthContext(c)
		if !ok {
			return
		}

		var body statusPagePayload
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		page, targets, updates, err := buildStatusPageModels(body, userID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		err = db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.NewInsert().Model(page).Exec(ctx); err != nil {
				return err
			}
			if len(targets) > 0 {
				if _, err := tx.NewInsert().Model(&targets).Exec(ctx); err != nil {
					return err
				}
			}
			if len(updates) > 0 {
				if _, err := tx.NewInsert().Model(&updates).Exec(ctx); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			status, message := normalizeWriteError(err)
			c.JSON(status, gin.H{"error": message})
			return
		}

		page.Targets = targets
		page.Updates = updates
		c.JSON(http.StatusCreated, page)
	}
}

func GetStatusPage(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, _, err := loadManagedPage(c, db)
		if err != nil {
			return
		}

		items, err := loadStatusPageItems(c, db, page)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load status page items"})
			return
		}

		c.JSON(http.StatusOK, statusPageResponse{Page: page, Items: items, Now: time.Now().UTC()})
	}
}

func UpdateStatusPage(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, userID, err := loadManagedPage(c, db)
		if err != nil {
			return
		}

		var body statusPagePayload
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		updated, targets, updates, err := buildStatusPageModels(body, userID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		page.Name = updated.Name
		page.Slug = updated.Slug
		page.Description = updated.Description
		page.Visibility = updated.Visibility
		page.IncludeAllTags = updated.IncludeAllTags
		page.ImagePatterns = updated.ImagePatterns
		page.StaleAfterHours = updated.StaleAfterHours
		page.UpdatedAt = updated.UpdatedAt

		err = db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.NewUpdate().Model(page).
				Column("name", "slug", "description", "visibility", "include_all_tags", "image_patterns", "stale_after_hours", "updated_at").
				Where("id = ?", page.ID).
				Exec(ctx); err != nil {
				return err
			}

			if _, err := tx.NewDelete().Model((*models.StatusPageTarget)(nil)).Where("page_id = ?", page.ID).Exec(ctx); err != nil {
				return err
			}
			if len(targets) > 0 {
				if _, err := tx.NewInsert().Model(&targets).Exec(ctx); err != nil {
					return err
				}
			}

			if _, err := tx.NewDelete().Model((*models.StatusPageUpdate)(nil)).Where("page_id = ?", page.ID).Exec(ctx); err != nil {
				return err
			}
			if len(updates) > 0 {
				if _, err := tx.NewInsert().Model(&updates).Exec(ctx); err != nil {
					return err
				}
			}

			return nil
		})
		if err != nil {
			status, message := normalizeWriteError(err)
			c.JSON(status, gin.H{"error": message})
			return
		}

		page.Targets = targets
		page.Updates = updates
		c.JSON(http.StatusOK, page)
	}
}

func DeleteStatusPage(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, _, err := loadManagedPage(c, db)
		if err != nil {
			return
		}

		if _, err := db.NewDelete().Model((*models.StatusPage)(nil)).Where("id = ?", page.ID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete status page"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}

func ViewStatusPageBySlug(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, ok := loadViewablePageBySlug(c, db)
		if !ok {
			return
		}

		items, err := loadStatusPageItems(c, db, page)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load status page items"})
			return
		}

		c.JSON(http.StatusOK, statusPageResponse{Page: page, Items: items, Now: time.Now().UTC()})
	}
}

func ViewStatusPageItemVulnerabilitiesBySlug(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, ok := loadViewablePageBySlug(c, db)
		if !ok {
			return
		}

		items, err := loadStatusPageItems(c, db, page)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load status page items"})
			return
		}

		scanIDParam := c.Param("scanId")
		var matched *StatusPageItem
		for i := range items {
			if items[i].LatestScanID == scanIDParam {
				matched = &items[i]
				break
			}
		}
		if matched == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "status page item not found"})
			return
		}

		scanID, err := uuid.Parse(scanIDParam)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		pageNumber, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "25"))
		if pageNumber < 1 {
			pageNumber = 1
		}
		if limit < 1 || limit > 500 {
			limit = 25
		}
		offset := (pageNumber - 1) * limit

		allowedCols := map[string]string{
			"vuln_id":           "vuln_id",
			"pkg_name":          "pkg_name",
			"severity":          "CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END",
			"cvss_score":        "cvss_score",
			"installed_version": "installed_version",
			"fixed_version":     "fixed_version",
		}
		sortCol := "severity"
		sortDir := "asc"
		if value := c.Query("sort_by"); value != "" {
			if _, exists := allowedCols[value]; exists {
				sortCol = value
			}
		}
		if value := c.Query("sort_dir"); value == "desc" {
			sortDir = "desc"
		}
		orderExpr := allowedCols[sortCol] + " " + sortDir
		if sortCol != "vuln_id" {
			orderExpr += ", vuln_id asc"
		}

		var vulns []models.Vulnerability
		q := db.NewSelect().Model(&vulns).
			Where("scan_id = ?", scanID).
			OrderExpr(orderExpr).
			Limit(limit).
			Offset(offset)

		if sev := c.Query("severity"); sev != "" {
			q = q.Where("severity = ?", sev)
		}
		if pkg := c.Query("pkg"); pkg != "" {
			q = q.Where("pkg_name ILIKE ?", "%"+pkg+"%")
		}
		if c.Query("has_fix") == "true" {
			q = q.Where("fixed_version != ''")
		}
		if minCVSS := c.Query("min_cvss"); minCVSS != "" {
			q = q.Where("cvss_score >= ?", minCVSS)
		}

		total, err := q.Count(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count vulnerabilities"})
			return
		}

		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list vulnerabilities"})
			return
		}

		vulnIDs := make([]string, len(vulns))
		for i, vuln := range vulns {
			vulnIDs[i] = vuln.VulnID
		}
		if len(vulnIDs) > 0 {
			var kbEntries []models.VulnKBEntry
			db.NewSelect().Model(&kbEntries).Where("vuln_id IN (?)", bun.In(vulnIDs)).Scan(c.Request.Context()) //nolint:errcheck
			kbMap := make(map[string]*models.VulnKBEntry, len(kbEntries))
			for i := range kbEntries {
				kbMap[kbEntries[i].VulnID] = &kbEntries[i]
			}
			for i := range vulns {
				if kb, exists := kbMap[vulns[i].VulnID]; exists {
					vulns[i].KBEntry = kb
				}
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"data":  vulns,
			"total": total,
			"page":  pageNumber,
			"limit": limit,
		})
	}
}

func loadManagedPage(c *gin.Context, db *bun.DB) (*models.StatusPage, uuid.UUID, error) {
	userID, tokenType, ok := requireAuthContext(c)
	if !ok {
		return nil, uuid.Nil, fmt.Errorf("unauthorized")
	}

	pageID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status page ID"})
		return nil, uuid.Nil, err
	}

	page := &models.StatusPage{}
	q := db.NewSelect().Model(page).Where("id = ?", pageID)
	if tokenType != "admin" {
		q = q.Where("owner_user_id = ?", userID)
	}
	if err := q.Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "status page not found"})
		return nil, uuid.Nil, err
	}

	if err := hydratePageRelations(c, db, page, false); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load status page"})
		return nil, uuid.Nil, err
	}

	return page, userID, nil
}

func loadViewablePageBySlug(c *gin.Context, db *bun.DB) (*models.StatusPage, bool) {
	page := &models.StatusPage{}
	if err := db.NewSelect().Model(page).Where("slug = ?", c.Param("slug")).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "status page not found"})
		return nil, false
	}

	if !canViewStatusPage(c, page) {
		return nil, false
	}

	return page, true
}

func hydratePageRelations(c *gin.Context, db *bun.DB, page *models.StatusPage, activeOnly bool) error {
	if err := db.NewSelect().Model(&page.Targets).
		Where("page_id = ?", page.ID).
		OrderExpr("display_order ASC, image_name ASC, image_tag ASC").
		Scan(c.Request.Context()); err != nil {
		return err
	}

	q := db.NewSelect().Model(&page.Updates).Where("page_id = ?", page.ID).OrderExpr("created_at DESC")
	if activeOnly {
		now := time.Now().UTC()
		q = q.Where("(active_from IS NULL OR active_from <= ?)", now).
			Where("(active_until IS NULL OR active_until >= ?)", now)
	}
	return q.Scan(c.Request.Context())
}

func loadStatusPageItems(c *gin.Context, db *bun.DB, page *models.StatusPage) ([]StatusPageItem, error) {
	if err := hydratePageRelations(c, db, page, true); err != nil {
		return nil, err
	}

	if !page.IncludeAllTags && len(page.Targets) == 0 && len(page.ImagePatterns) == 0 {
		return []StatusPageItem{}, nil
	}

	compiledPatterns, err := compileStatusPagePatterns(page.ImagePatterns)
	if err != nil {
		return nil, err
	}

	exactTargetOrders := make(map[string]int, len(page.Targets))
	for _, target := range page.Targets {
		key := statusPageTargetKey(target.ImageName, target.ImageTag)
		if _, exists := exactTargetOrders[key]; !exists {
			exactTargetOrders[key] = target.DisplayOrder
		}
	}

	args := []any{page.OwnerUserID}
	query := `
WITH ranked AS (
    SELECT
        s.id::text AS latest_scan_id,
        s.image_name,
        s.image_tag,
        s.status AS scan_status,
        s.error_message,
        s.critical_count,
        s.high_count,
        s.medium_count,
        s.low_count,
        s.created_at,
        s.completed_at,
        ROW_NUMBER() OVER (PARTITION BY s.image_name, s.image_tag ORDER BY s.created_at DESC) AS rn
    FROM scans s
    WHERE s.user_id = ?
),
latest AS (
    SELECT * FROM ranked WHERE rn = 1
),
previous AS (
    SELECT
        image_name,
        image_tag,
        critical_count AS previous_critical_count,
        high_count AS previous_high_count,
        medium_count AS previous_medium_count,
        low_count AS previous_low_count,
        created_at AS previous_scan_at
    FROM ranked
    WHERE rn = 2
)
SELECT
    l.image_name,
    l.image_tag,
    l.latest_scan_id,
    l.scan_status,
    l.error_message,
    l.critical_count,
    l.high_count,
    l.medium_count,
    l.low_count,
    COALESCE(l.completed_at, l.created_at) AS observed_at,
    p.previous_critical_count,
    p.previous_high_count,
    p.previous_medium_count,
    p.previous_low_count,
    p.previous_scan_at
FROM latest l
LEFT JOIN previous p ON p.image_name = l.image_name AND p.image_tag = l.image_tag
ORDER BY l.image_name ASC, l.image_tag ASC`

	rows, err := db.QueryContext(c.Request.Context(), query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	now := time.Now().UTC()
	items := make([]StatusPageItem, 0)
	exactItems := make([]StatusPageItem, 0, len(page.Targets))
	patternItems := make([]StatusPageItem, 0)
	for rows.Next() {
		var item StatusPageItem
		var prevCritical sql.NullInt64
		var prevHigh sql.NullInt64
		var prevMedium sql.NullInt64
		var prevLow sql.NullInt64
		var previousScanAt sql.NullTime
		if err := rows.Scan(
			&item.ImageName,
			&item.ImageTag,
			&item.LatestScanID,
			&item.ScanStatus,
			&item.ErrorMessage,
			&item.CriticalCount,
			&item.HighCount,
			&item.MediumCount,
			&item.LowCount,
			&item.ObservedAt,
			&prevCritical,
			&prevHigh,
			&prevMedium,
			&prevLow,
			&previousScanAt,
		); err != nil {
			return nil, err
		}

		item.FreshnessHours = int64(now.Sub(item.ObservedAt).Hours())
		item.Status = deriveStatus(page.StaleAfterHours, item)
		if prevCritical.Valid {
			value := int(prevCritical.Int64)
			item.PreviousCriticalCount = &value
			delta := item.CriticalCount - value
			item.DeltaCriticalCount = &delta
		}
		if prevHigh.Valid {
			value := int(prevHigh.Int64)
			item.PreviousHighCount = &value
			delta := item.HighCount - value
			item.DeltaHighCount = &delta
		}
		if prevMedium.Valid {
			value := int(prevMedium.Int64)
			item.PreviousMediumCount = &value
			delta := item.MediumCount - value
			item.DeltaMediumCount = &delta
		}
		if prevLow.Valid {
			value := int(prevLow.Int64)
			item.PreviousLowCount = &value
			delta := item.LowCount - value
			item.DeltaLowCount = &delta
		}
		if previousScanAt.Valid {
			value := previousScanAt.Time
			item.PreviousScanAt = &value
		}

		if page.IncludeAllTags {
			items = append(items, item)
			continue
		}

		if displayOrder, exists := exactTargetOrders[statusPageTargetKey(item.ImageName, item.ImageTag)]; exists {
			item.DisplayOrder = displayOrder
			exactItems = append(exactItems, item)
			continue
		}

		if matchesStatusPagePatterns(compiledPatterns, item.ImageName, item.ImageTag) {
			patternItems = append(patternItems, item)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if page.IncludeAllTags {
		if items == nil {
			return []StatusPageItem{}, nil
		}
		return items, nil
	}

	sort.Slice(exactItems, func(i, j int) bool {
		if exactItems[i].DisplayOrder == exactItems[j].DisplayOrder {
			return statusPageItemLess(exactItems[i], exactItems[j])
		}
		return exactItems[i].DisplayOrder < exactItems[j].DisplayOrder
	})
	sort.Slice(patternItems, func(i, j int) bool {
		return statusPageItemLess(patternItems[i], patternItems[j])
	})
	for index := range patternItems {
		patternItems[index].DisplayOrder = len(exactItems) + index + 1
	}

	items = append(exactItems, patternItems...)
	if items == nil {
		return []StatusPageItem{}, nil
	}

	return items, nil
}

func deriveStatus(staleAfterHours int, item StatusPageItem) string {
	if item.ScanStatus == models.ScanStatusFailed {
		return "failed"
	}
	if item.ScanStatus == models.ScanStatusPending || item.ScanStatus == models.ScanStatusRunning || item.ScanStatus == models.ScanStatusCancelled {
		return item.ScanStatus
	}
	if staleAfterHours > 0 && item.FreshnessHours >= int64(staleAfterHours) {
		return "stale"
	}
	if item.CriticalCount > 0 || item.HighCount > 0 {
		return "degraded"
	}
	return "healthy"
}

func buildStatusPageModels(body statusPagePayload, userID uuid.UUID) (*models.StatusPage, []models.StatusPageTarget, []models.StatusPageUpdate, error) {
	visibility := strings.TrimSpace(strings.ToLower(body.Visibility))
	if visibility != models.StatusPageVisibilityPrivate && visibility != models.StatusPageVisibilityPublic && visibility != models.StatusPageVisibilityAuthenticated {
		return nil, nil, nil, fmt.Errorf("visibility must be 'private', 'public', or 'authenticated'")
	}

	name := strings.TrimSpace(body.Name)
	if name == "" {
		return nil, nil, nil, fmt.Errorf("name is required")
	}

	slug := normalizeSlug(body.Slug)
	if slug == "" {
		slug = normalizeSlug(name)
	}
	if slug == "" {
		return nil, nil, nil, fmt.Errorf("slug must contain at least one alphanumeric character")
	}

	staleAfterHours := body.StaleAfterHours
	if staleAfterHours <= 0 {
		staleAfterHours = 72
	}

	imagePatterns, err := normalizeStatusPagePatterns(body.ImagePatterns)
	if err != nil {
		return nil, nil, nil, err
	}

	now := time.Now().UTC()
	pageID := uuid.New()
	page := &models.StatusPage{
		ID:              pageID,
		Name:            name,
		Slug:            slug,
		Description:     strings.TrimSpace(body.Description),
		Visibility:      visibility,
		IncludeAllTags:  body.IncludeAllTags,
		ImagePatterns:   imagePatterns,
		StaleAfterHours: staleAfterHours,
		OwnerUserID:     userID,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	targets := make([]models.StatusPageTarget, 0, len(body.Targets))
	seenTargets := make(map[string]struct{}, len(body.Targets))
	for index, target := range body.Targets {
		imageName := strings.TrimSpace(target.ImageName)
		imageTag := strings.TrimSpace(target.ImageTag)
		if imageName == "" || imageTag == "" {
			return nil, nil, nil, fmt.Errorf("each target requires image_name and image_tag")
		}
		key := imageName + "::" + imageTag
		if _, exists := seenTargets[key]; exists {
			continue
		}
		seenTargets[key] = struct{}{}
		displayOrder := target.DisplayOrder
		if displayOrder == 0 {
			displayOrder = index + 1
		}
		targets = append(targets, models.StatusPageTarget{
			ID:           uuid.New(),
			PageID:       pageID,
			ImageName:    imageName,
			ImageTag:     imageTag,
			DisplayOrder: displayOrder,
			CreatedAt:    now,
		})
	}
	if !page.IncludeAllTags && len(targets) == 0 && len(imagePatterns) == 0 {
		return nil, nil, nil, fmt.Errorf("at least one exact target or image regex is required when include_all_tags is false")
	}

	updates := make([]models.StatusPageUpdate, 0, len(body.Updates))
	for _, update := range body.Updates {
		title := strings.TrimSpace(update.Title)
		if title == "" {
			return nil, nil, nil, fmt.Errorf("each update requires a title")
		}
		level := strings.TrimSpace(strings.ToLower(update.Level))
		if level == "" {
			level = "info"
		}
		if level != "info" && level != "maintenance" && level != "incident" {
			return nil, nil, nil, fmt.Errorf("update level must be 'info', 'maintenance', or 'incident'")
		}
		updates = append(updates, models.StatusPageUpdate{
			ID:              uuid.New(),
			PageID:          pageID,
			Title:           title,
			Body:            strings.TrimSpace(update.Body),
			Level:           level,
			ActiveFrom:      update.ActiveFrom,
			ActiveUntil:     update.ActiveUntil,
			CreatedByUserID: userID,
			CreatedAt:       now,
			UpdatedAt:       now,
		})
	}

	return page, targets, updates, nil
}

func normalizeStatusPagePatterns(patterns []string) (models.StringList, error) {
	seen := make(map[string]struct{}, len(patterns))
	normalized := make(models.StringList, 0, len(patterns))
	for _, rawPattern := range patterns {
		pattern := strings.TrimSpace(rawPattern)
		if pattern == "" {
			continue
		}
		if _, err := regexp.Compile(pattern); err != nil {
			return nil, fmt.Errorf("invalid image regex %q: %w", pattern, err)
		}
		if _, exists := seen[pattern]; exists {
			continue
		}
		seen[pattern] = struct{}{}
		normalized = append(normalized, pattern)
	}
	return normalized, nil
}

func compileStatusPagePatterns(patterns models.StringList) ([]*regexp.Regexp, error) {
	compiled := make([]*regexp.Regexp, 0, len(patterns))
	for _, pattern := range patterns {
		re, err := regexp.Compile(pattern)
		if err != nil {
			return nil, fmt.Errorf("invalid stored image regex %q: %w", pattern, err)
		}
		compiled = append(compiled, re)
	}
	return compiled, nil
}

func matchesStatusPagePatterns(patterns []*regexp.Regexp, imageName, imageTag string) bool {
	if len(patterns) == 0 {
		return false
	}

	fullReference := imageName + ":" + imageTag
	for _, pattern := range patterns {
		if pattern.MatchString(fullReference) || pattern.MatchString(imageName) || pattern.MatchString(imageTag) {
			return true
		}
	}

	return false
}

func statusPageTargetKey(imageName, imageTag string) string {
	return imageName + "::" + imageTag
}

func statusPageItemLess(left, right StatusPageItem) bool {
	if left.ImageName == right.ImageName {
		return left.ImageTag < right.ImageTag
	}
	return left.ImageName < right.ImageName
}

func requireAuthContext(c *gin.Context) (uuid.UUID, string, bool) {
	userID, err := auth.GetUserIDFromToken(c.GetHeader("Authorization"))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return uuid.Nil, "", false
	}
	tokenType, _ := auth.GetTypeFromToken(c.GetHeader("Authorization"))
	return userID, tokenType, true
}

func canViewStatusPage(c *gin.Context, page *models.StatusPage) bool {
	switch page.Visibility {
	case models.StatusPageVisibilityPublic:
		return true
	case models.StatusPageVisibilityAuthenticated:
		if auth.ValidateToken(strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")) != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required to view this status page"})
			return false
		}
		return true
	case models.StatusPageVisibilityPrivate:
		userID, err := auth.GetUserIDFromToken(c.GetHeader("Authorization"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required to view this status page"})
			return false
		}
		tokenType, _ := auth.GetTypeFromToken(c.GetHeader("Authorization"))
		if tokenType == "admin" || userID == page.OwnerUserID {
			return true
		}
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return false
	default:
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid status page visibility"})
		return false
	}
}

func normalizeSlug(input string) string {
	value := strings.ToLower(strings.TrimSpace(input))
	value = slugPattern.ReplaceAllString(value, "-")
	value = strings.Trim(value, "-")
	return value
}

func normalizeWriteError(err error) (int, string) {
	if strings.Contains(strings.ToLower(err.Error()), "duplicate key") || strings.Contains(strings.ToLower(err.Error()), "unique") {
		return http.StatusConflict, "status page slug already exists"
	}
	return http.StatusInternalServerError, "failed to persist status page"
}
