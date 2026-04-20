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
	"justscan-backend/functions/authz"
	"justscan-backend/functions/blockedpolicy"
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
	OrgID           string                    `json:"org_id"`
	IncludeAllTags  bool                      `json:"include_all_tags"`
	ImagePatterns   []string                  `json:"image_patterns"`
	StaleAfterHours int                       `json:"stale_after_hours"`
	Targets         []statusPageTargetPayload `json:"targets"`
	Updates         []statusPageUpdatePayload `json:"updates"`
}

type StatusPageItem struct {
	ImageName             string                       `json:"image_name"`
	ImageTag              string                       `json:"image_tag"`
	LatestScanID          string                       `json:"latest_scan_id"`
	ScanStatus            string                       `json:"scan_status"`
	ExternalStatus        string                       `json:"external_status,omitempty"`
	ScanProvider          string                       `json:"scan_provider,omitempty"`
	CurrentStep           string                       `json:"current_step,omitempty"`
	StartedAt             *time.Time                   `json:"started_at,omitempty"`
	Status                string                       `json:"status"`
	ErrorMessage          string                       `json:"error_message,omitempty"`
	BlockedPolicyDetails  *models.BlockedPolicyDetails `json:"blocked_policy_details,omitempty"`
	CriticalCount         int                          `json:"critical_count"`
	HighCount             int                          `json:"high_count"`
	MediumCount           int                          `json:"medium_count"`
	LowCount              int                          `json:"low_count"`
	PreviousScanID        *string                      `json:"previous_scan_id,omitempty"`
	PreviousCriticalCount *int                         `json:"previous_critical_count,omitempty"`
	PreviousHighCount     *int                         `json:"previous_high_count,omitempty"`
	PreviousMediumCount   *int                         `json:"previous_medium_count,omitempty"`
	PreviousLowCount      *int                         `json:"previous_low_count,omitempty"`
	FreshnessHours        int64                        `json:"freshness_hours"`
	ObservedAt            time.Time                    `json:"observed_at"`
	PreviousScanAt        *time.Time                   `json:"previous_scan_at,omitempty"`
	DisplayOrder          int                          `json:"display_order"`
	DeltaCriticalCount    *int                         `json:"delta_critical_count,omitempty"`
	DeltaHighCount        *int                         `json:"delta_high_count,omitempty"`
	DeltaMediumCount      *int                         `json:"delta_medium_count,omitempty"`
	DeltaLowCount         *int                         `json:"delta_low_count,omitempty"`
}

type statusPageScanSummary struct {
	ScanID               string                       `json:"scan_id"`
	ImageName            string                       `json:"image_name"`
	ImageTag             string                       `json:"image_tag"`
	ScanStatus           string                       `json:"scan_status"`
	ExternalStatus       string                       `json:"external_status,omitempty"`
	ScanProvider         string                       `json:"scan_provider,omitempty"`
	CurrentStep          string                       `json:"current_step,omitempty"`
	ErrorMessage         string                       `json:"error_message,omitempty"`
	BlockedPolicyDetails *models.BlockedPolicyDetails `json:"blocked_policy_details,omitempty"`
	CriticalCount        int                          `json:"critical_count"`
	HighCount            int                          `json:"high_count"`
	MediumCount          int                          `json:"medium_count"`
	LowCount             int                          `json:"low_count"`
	StartedAt            *time.Time                   `json:"started_at,omitempty"`
	CompletedAt          *time.Time                   `json:"completed_at,omitempty"`
	CreatedAt            time.Time                    `json:"created_at"`
	ObservedAt           time.Time                    `json:"observed_at"`
	IsLatest             bool                         `json:"is_latest"`
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
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}

		var pages []models.StatusPage
		q := db.NewSelect().Model(&pages).OrderExpr("updated_at DESC")
		if !isAdmin {
			q = authz.ApplyOwnershipVisibility(q, "status_page", "", "owner_user_id", "owner_org_id", "org_status_pages", "status_page_id", userID, isAdmin, accessibleOrgIDs)
		}
		q = authz.ApplyWorkspaceScope(c, q, "status_page", "owner_user_id", "owner_org_id", "org_status_pages", "status_page_id", userID)
		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list status pages"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": pages})
	}
}

func CreateStatusPage(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _, ok := requireAuthContext(c, db)
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
		if orgID, hasOrg, ok := parseStatusPageMutationOrg(c, db, body.OrgID); !ok {
			return
		} else if hasOrg {
			page.OwnerType = models.OwnerTypeOrg
			page.OwnerUserID = nil
			page.OwnerOrgID = &orgID
		}

		err = db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.NewInsert().Model(page).Exec(ctx); err != nil {
				return err
			}
			if page.OwnerOrgID != nil {
				if err := ensureOrgStatusPageLink(ctx, tx, *page.OwnerOrgID, page.ID); err != nil {
					return err
				}
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
		page, err := loadAuthorizedPage(c, db)
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
		page, userID, _, err := loadManagedPage(c, db)
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
		page, _, _, err := loadManagedPage(c, db)
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

type statusPageShare struct {
	OrgID          uuid.UUID `bun:"org_id" json:"org_id"`
	OrgName        string    `bun:"org_name" json:"org_name"`
	OrgDescription string    `bun:"org_description" json:"org_description"`
	IsOwner        bool      `bun:"-" json:"is_owner"`
}

func ListStatusPageShares(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, _, _, err := loadManagedPage(c, db)
		if err != nil {
			return
		}

		var shares []statusPageShare
		if err := db.NewSelect().
			TableExpr("org_status_pages AS org_status_page").
			ColumnExpr("o.id AS org_id").
			ColumnExpr("o.name AS org_name").
			ColumnExpr("o.description AS org_description").
			Join("JOIN orgs AS o ON o.id = org_status_page.org_id").
			Where("org_status_page.status_page_id = ?", page.ID).
			OrderExpr("o.name ASC").
			Scan(c.Request.Context(), &shares); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list status page shares"})
			return
		}

		for index := range shares {
			shares[index].IsOwner = page.OwnerOrgID != nil && shares[index].OrgID == *page.OwnerOrgID
		}

		c.JSON(http.StatusOK, gin.H{"data": shares})
	}
}

func ShareStatusPage(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, _, isAdmin, err := loadManagedPage(c, db)
		if err != nil {
			return
		}

		var body struct {
			OrgID string `json:"org_id" binding:"required"`
		}
		if bindErr := c.ShouldBindJSON(&body); bindErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": bindErr.Error()})
			return
		}

		targetOrgID, parseErr := uuid.Parse(body.OrgID)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
			return
		}
		if page.OwnerOrgID != nil && *page.OwnerOrgID == targetOrgID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "resource is already owned by that organization"})
			return
		}
		if !isAdmin {
			if _, _, _, _, ok := authz.RequireOrgRole(c, db, targetOrgID, models.OrgRoleEditor); !ok {
				return
			}
		}

		if err := ensureOrgStatusPageLink(c.Request.Context(), db, targetOrgID, page.ID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to share status page"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"result": "shared"})
	}
}

func UnshareStatusPage(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, _, _, err := loadManagedPage(c, db)
		if err != nil {
			return
		}

		targetOrgID, parseErr := uuid.Parse(c.Param("orgId"))
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
			return
		}
		if page.OwnerOrgID != nil && *page.OwnerOrgID == targetOrgID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot remove the owner organization"})
			return
		}

		if _, err := db.NewDelete().Model((*models.OrgStatusPage)(nil)).
			Where("org_id = ?", targetOrgID).
			Where("status_page_id = ?", page.ID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke status page share"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "unshared"})
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

func ViewStatusPageScanBySlug(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, ok := loadViewablePageBySlug(c, db)
		if !ok {
			return
		}

		scan, err := loadTrackedScanForPage(c, db, page, c.Param("scanId"))
		if err != nil {
			status := http.StatusInternalServerError
			switch err.Error() {
			case "invalid scan ID":
				status = http.StatusBadRequest
			case "scan not found", "status page item not found":
				status = http.StatusNotFound
			}
			c.JSON(status, gin.H{"error": err.Error()})
			return
		}
		if err := blockedpolicy.AttachScanDetails(c.Request.Context(), db, scan); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load blocked policy details"})
			return
		}

		latestScanID, _ := latestTrackedScanID(c.Request.Context(), db, page, scan.ImageName, scan.ImageTag)
		c.JSON(http.StatusOK, buildStatusPageScanSummary(scan, latestScanID))
	}
}

func ViewStatusPageScanHistoryBySlug(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, ok := loadViewablePageBySlug(c, db)
		if !ok {
			return
		}

		scan, err := loadTrackedScanForPage(c, db, page, c.Param("scanId"))
		if err != nil {
			status := http.StatusInternalServerError
			switch err.Error() {
			case "invalid scan ID":
				status = http.StatusBadRequest
			case "scan not found", "status page item not found":
				status = http.StatusNotFound
			}
			c.JSON(status, gin.H{"error": err.Error()})
			return
		}

		var scans []models.Scan
		historyQuery := db.NewSelect().
			Model(&scans).
			Where("image_name = ?", scan.ImageName).
			Where("image_tag = ?", scan.ImageTag).
			OrderExpr("created_at DESC").
			Limit(10)
		historyQuery = applyStatusPageScanScopeQuery(historyQuery, page, "scan")
		if err := historyQuery.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan history"})
			return
		}

		items := make([]statusPageScanSummary, 0, len(scans))
		for i := range scans {
			if err := blockedpolicy.AttachScanDetails(c.Request.Context(), db, &scans[i]); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load blocked policy details"})
				return
			}
			items = append(items, buildStatusPageScanSummary(&scans[i], scans[0].ID))
		}

		c.JSON(http.StatusOK, gin.H{"data": items})
	}
}

func ViewStatusPageItemVulnerabilitiesBySlug(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, ok := loadViewablePageBySlug(c, db)
		if !ok {
			return
		}

		scan, err := loadTrackedScanForPage(c, db, page, c.Param("scanId"))
		if err != nil {
			status := http.StatusInternalServerError
			switch err.Error() {
			case "invalid scan ID":
				status = http.StatusBadRequest
			case "scan not found", "status page item not found":
				status = http.StatusNotFound
			}
			c.JSON(status, gin.H{"error": err.Error()})
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
			Where("scan_id = ?", scan.ID).
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

func loadManagedPage(c *gin.Context, db *bun.DB) (*models.StatusPage, uuid.UUID, bool, error) {
	userID, isAdmin, ok := requireAuthContext(c, db)
	if !ok {
		return nil, uuid.Nil, false, fmt.Errorf("unauthorized")
	}

	pageID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status page ID"})
		return nil, uuid.Nil, false, err
	}

	page := &models.StatusPage{}
	if err := db.NewSelect().Model(page).Where("id = ?", pageID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "status page not found"})
		return nil, uuid.Nil, false, err
	}
	if !canManageStatusPage(c.Request.Context(), db, page, userID, isAdmin) {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return nil, uuid.Nil, false, fmt.Errorf("forbidden")
	}

	if err := hydratePageRelations(c, db, page, false); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load status page"})
		return nil, uuid.Nil, false, err
	}

	return page, userID, isAdmin, nil
}

func loadAuthorizedPage(c *gin.Context, db *bun.DB) (*models.StatusPage, error) {
	userID, isAdmin, ok := requireAuthContext(c, db)
	if !ok {
		return nil, fmt.Errorf("unauthorized")
	}

	pageID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status page ID"})
		return nil, err
	}

	page := &models.StatusPage{}
	if err := db.NewSelect().Model(page).Where("id = ?", pageID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "status page not found"})
		return nil, err
	}
	if !canReadStatusPageRecord(c.Request.Context(), db, page, userID, isAdmin) {
		c.JSON(http.StatusNotFound, gin.H{"error": "status page not found"})
		return nil, fmt.Errorf("not found")
	}

	if err := hydratePageRelations(c, db, page, false); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load status page"})
		return nil, err
	}

	return page, nil
}

func loadViewablePageBySlug(c *gin.Context, db *bun.DB) (*models.StatusPage, bool) {
	page := &models.StatusPage{}
	if err := db.NewSelect().Model(page).Where("slug = ?", c.Param("slug")).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "status page not found"})
		return nil, false
	}

	if !canViewStatusPage(c, db, page) {
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

	scopeWhere, args := statusPageScanScopeWhere(page, "s")
	query := `
WITH ranked AS (
    SELECT
		s.id::text AS scan_id,
        s.id::text AS latest_scan_id,
        s.image_name,
        s.image_tag,
        s.status AS scan_status,
		s.external_status,
		s.scan_provider,
		s.current_step,
		s.started_at,
        s.error_message,
        s.critical_count,
        s.high_count,
        s.medium_count,
        s.low_count,
        s.created_at,
        s.completed_at,
        ROW_NUMBER() OVER (PARTITION BY s.image_name, s.image_tag ORDER BY s.created_at DESC) AS rn
    FROM scans s
	WHERE ` + scopeWhere + `
),
latest AS (
    SELECT * FROM ranked WHERE rn = 1
),
previous AS (
    SELECT
		scan_id AS previous_scan_id,
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
		l.external_status,
		l.scan_provider,
		l.current_step,
		l.started_at,
    l.error_message,
    l.critical_count,
    l.high_count,
    l.medium_count,
    l.low_count,
    COALESCE(l.completed_at, l.created_at) AS observed_at,
		p.previous_scan_id,
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
		var externalStatus sql.NullString
		var scanProvider sql.NullString
		var currentStep sql.NullString
		var errorMessage sql.NullString
		var prevCritical sql.NullInt64
		var prevHigh sql.NullInt64
		var prevMedium sql.NullInt64
		var prevLow sql.NullInt64
		var previousScanID sql.NullString
		var previousScanAt sql.NullTime
		if err := rows.Scan(
			&item.ImageName,
			&item.ImageTag,
			&item.LatestScanID,
			&item.ScanStatus,
			&externalStatus,
			&scanProvider,
			&currentStep,
			&item.StartedAt,
			&errorMessage,
			&item.CriticalCount,
			&item.HighCount,
			&item.MediumCount,
			&item.LowCount,
			&item.ObservedAt,
			&previousScanID,
			&prevCritical,
			&prevHigh,
			&prevMedium,
			&prevLow,
			&previousScanAt,
		); err != nil {
			return nil, err
		}

		if externalStatus.Valid {
			item.ExternalStatus = externalStatus.String
		}
		if scanProvider.Valid {
			item.ScanProvider = scanProvider.String
		}
		if currentStep.Valid {
			item.CurrentStep = currentStep.String
		}
		if errorMessage.Valid {
			item.ErrorMessage = errorMessage.String
		}
		if item.ExternalStatus == models.ScanExternalStatusBlockedByXrayPolicy {
			if scanID, err := uuid.Parse(item.LatestScanID); err == nil {
				details, detailErr := blockedpolicy.BuildDetails(c.Request.Context(), db, scanID, item.ExternalStatus, item.ErrorMessage)
				if detailErr != nil {
					return nil, detailErr
				}
				item.BlockedPolicyDetails = details
			}
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
		if previousScanID.Valid {
			value := previousScanID.String
			item.PreviousScanID = &value
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
	if item.ScanStatus == models.ScanStatusFailed && item.ExternalStatus == models.ScanExternalStatusBlockedByXrayPolicy {
		return models.ScanExternalStatusBlockedByXrayPolicy
	}
	if item.ScanStatus == models.ScanStatusFailed {
		return "failed"
	}
	if item.ScanStatus == models.ScanStatusPending || item.ScanStatus == models.ScanStatusRunning || item.ScanStatus == models.ScanStatusCancelled {
		return item.ScanStatus
	}
	if staleAfterHours > 0 && item.FreshnessHours >= int64(staleAfterHours) {
		return "stale"
	}
	return "healthy"
}

func loadTrackedScanForPage(c *gin.Context, db *bun.DB, page *models.StatusPage, scanIDParam string) (*models.Scan, error) {
	if err := hydratePageRelations(c, db, page, true); err != nil {
		return nil, err
	}

	scanID, err := uuid.Parse(scanIDParam)
	if err != nil {
		return nil, fmt.Errorf("invalid scan ID")
	}

	scan := &models.Scan{}
	query := db.NewSelect().
		Model(scan).
		Where("id = ?", scanID)
	query = applyStatusPageScanScopeQuery(query, page, "scan")
	if err := query.Scan(c.Request.Context()); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("scan not found")
		}
		return nil, err
	}

	tracked, err := statusPageIncludesImage(page, scan.ImageName, scan.ImageTag)
	if err != nil {
		return nil, err
	}
	if !tracked {
		return nil, fmt.Errorf("status page item not found")
	}

	return scan, nil
}

func statusPageIncludesImage(page *models.StatusPage, imageName, imageTag string) (bool, error) {
	if page.IncludeAllTags {
		return true, nil
	}

	for _, target := range page.Targets {
		if target.ImageName == imageName && target.ImageTag == imageTag {
			return true, nil
		}
	}

	compiledPatterns, err := compileStatusPagePatterns(page.ImagePatterns)
	if err != nil {
		return false, err
	}

	return matchesStatusPagePatterns(compiledPatterns, imageName, imageTag), nil
}

func latestTrackedScanID(ctx context.Context, db *bun.DB, page *models.StatusPage, imageName, imageTag string) (uuid.UUID, error) {
	var latestID uuid.UUID
	query := db.NewSelect().
		Model((*models.Scan)(nil)).
		Column("id").
		Where("image_name = ?", imageName).
		Where("image_tag = ?", imageTag).
		OrderExpr("created_at DESC").
		Limit(1)
	query = applyStatusPageScanScopeQuery(query, page, "scan")
	if err := query.Scan(ctx, &latestID); err != nil {
		return uuid.Nil, err
	}
	return latestID, nil
}

func buildStatusPageScanSummary(scan *models.Scan, latestScanID uuid.UUID) statusPageScanSummary {
	observedAt := scan.CreatedAt
	if scan.CompletedAt != nil {
		observedAt = *scan.CompletedAt
	}

	return statusPageScanSummary{
		ScanID:               scan.ID.String(),
		ImageName:            scan.ImageName,
		ImageTag:             scan.ImageTag,
		ScanStatus:           scan.Status,
		ExternalStatus:       scan.ExternalStatus,
		ScanProvider:         scan.ScanProvider,
		CurrentStep:          scan.CurrentStep,
		ErrorMessage:         scan.ErrorMessage,
		BlockedPolicyDetails: scan.BlockedPolicyDetails,
		CriticalCount:        scan.CriticalCount,
		HighCount:            scan.HighCount,
		MediumCount:          scan.MediumCount,
		LowCount:             scan.LowCount,
		StartedAt:            scan.StartedAt,
		CompletedAt:          scan.CompletedAt,
		CreatedAt:            scan.CreatedAt,
		ObservedAt:           observedAt,
		IsLatest:             latestScanID != uuid.Nil && scan.ID == latestScanID,
	}
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
		OwnerType:       models.OwnerTypeUser,
		OwnerUserID:     &userID,
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

func parseStatusPageMutationOrg(c *gin.Context, db *bun.DB, rawOrgID string) (uuid.UUID, bool, bool) {
	rawOrgID = strings.TrimSpace(rawOrgID)
	if rawOrgID == "" {
		return uuid.Nil, false, true
	}

	orgID, err := uuid.Parse(rawOrgID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
		return uuid.Nil, false, false
	}
	if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleEditor); !ok {
		return uuid.Nil, false, false
	}

	return orgID, true, true
}

func ensureOrgStatusPageLink(ctx context.Context, db bun.IDB, orgID, pageID uuid.UUID) error {
	_, err := db.NewInsert().Model(&models.OrgStatusPage{OrgID: orgID, StatusPageID: pageID}).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}

func canManageStatusPage(ctx context.Context, db *bun.DB, page *models.StatusPage, userID uuid.UUID, isAdmin bool) bool {
	if page == nil {
		return false
	}
	if isAdmin {
		return true
	}
	if page.OwnerType == models.OwnerTypeUser && page.OwnerUserID != nil && *page.OwnerUserID == userID {
		return true
	}
	if page.OwnerOrgID == nil {
		return false
	}
	roles, err := authz.LoadUserOrgRoles(ctx, db, userID)
	if err != nil {
		return false
	}
	return authz.HasOrgRoleAtLeast(roles, *page.OwnerOrgID, models.OrgRoleEditor)
}

func canReadStatusPageRecord(ctx context.Context, db *bun.DB, page *models.StatusPage, userID uuid.UUID, isAdmin bool) bool {
	if page == nil {
		return false
	}
	if isAdmin {
		return true
	}
	if page.OwnerType == models.OwnerTypeUser && page.OwnerUserID != nil && *page.OwnerUserID == userID {
		return true
	}

	accessibleOrgIDs, err := authz.ListAccessibleOrgIDs(ctx, db, userID, false)
	if err != nil || len(accessibleOrgIDs) == 0 {
		return false
	}
	if page.OwnerOrgID != nil {
		for _, orgID := range accessibleOrgIDs {
			if orgID == *page.OwnerOrgID {
				return true
			}
		}
	}
	shared, err := db.NewSelect().
		TableExpr("org_status_pages").
		Where("status_page_id = ?", page.ID).
		Where("org_id IN (?)", bun.In(accessibleOrgIDs)).
		Exists(ctx)
	return err == nil && shared
}

func applyStatusPageScanScopeQuery(query *bun.SelectQuery, page *models.StatusPage, alias string) *bun.SelectQuery {
	whereClause, args := statusPageScanScopeWhere(page, alias)
	return query.Where(whereClause, args...)
}

func statusPageScanScopeWhere(page *models.StatusPage, alias string) (string, []any) {
	if page.OwnerType == models.OwnerTypeOrg && page.OwnerOrgID != nil {
		return fmt.Sprintf("(%s.owner_org_id = ? OR EXISTS (SELECT 1 FROM org_scans os WHERE os.scan_id = %s.id AND os.org_id = ?))", alias, alias), []any{*page.OwnerOrgID, *page.OwnerOrgID}
	}
	ownerUserID := uuid.Nil
	if page.OwnerUserID != nil {
		ownerUserID = *page.OwnerUserID
	}
	return fmt.Sprintf("(%s.owner_user_id = ? OR %s.user_id = ?)", alias, alias), []any{ownerUserID, ownerUserID}
}

func requireAuthContext(c *gin.Context, db *bun.DB) (uuid.UUID, bool, bool) {
	userID, isAdmin, err := auth.ResolveUserAccess(c.GetHeader("Authorization"), db)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return uuid.Nil, false, false
	}
	return userID, isAdmin, true
}

func canViewStatusPage(c *gin.Context, db *bun.DB, page *models.StatusPage) bool {
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
		userID, isAdmin, err := auth.ResolveUserAccess(c.GetHeader("Authorization"), db)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required to view this status page"})
			return false
		}
		if canReadStatusPageRecord(c.Request.Context(), db, page, userID, isAdmin) {
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
