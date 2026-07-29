package statuspages

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"justscan-backend/functions/auth"
	"justscan-backend/functions/authz"
	"justscan-backend/functions/blockedpolicy"
	"justscan-backend/functions/resourceownership"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

var slugPattern = regexp.MustCompile(`[^a-z0-9]+`)

const statusPageHistoryDays = 14

type statusPageTargetPayload struct {
	ImageName    string `json:"image_name"`
	ImageTag     string `json:"image_tag"`
	DisplayOrder int    `json:"display_order"`
}

type statusPageGitRepositorySourcePayload struct {
	RepositoryID string `json:"repository_id" binding:"required"`
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
	Name                 string                                 `json:"name" binding:"required"`
	Slug                 string                                 `json:"slug"`
	Description          string                                 `json:"description"`
	Visibility           string                                 `json:"visibility" binding:"required"`
	OrgID                string                                 `json:"org_id"`
	IncludeAllTags       bool                                   `json:"include_all_tags"`
	ImagePatterns        []string                               `json:"image_patterns"`
	StaleAfterHours      int                                    `json:"stale_after_hours"`
	Targets              []statusPageTargetPayload              `json:"targets"`
	GitRepositorySources []statusPageGitRepositorySourcePayload `json:"git_repository_sources"`
	Updates              []statusPageUpdatePayload              `json:"updates"`
}

type StatusPageItem struct {
	ImageName             string                       `json:"image_name"`
	ImageTag              string                       `json:"image_tag"`
	LatestScanID          string                       `json:"latest_scan_id"`
	ScanStatus            string                       `json:"scan_status"`
	ExternalStatus        string                       `json:"external_status,omitempty"`
	ComplianceStatus      string                       `json:"compliance_status,omitempty"`
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
	SourceType            string                       `json:"source_type,omitempty"`
	SourceRepositoryID    string                       `json:"source_repository_id,omitempty"`
	SourceRepositoryName  string                       `json:"source_repository_name,omitempty"`
	SourceRunID           string                       `json:"source_run_id,omitempty"`
	FullRef               string                       `json:"full_ref,omitempty"`
	DiscoveryState        string                       `json:"discovery_state,omitempty"`
	DeltaCriticalCount    *int                         `json:"delta_critical_count,omitempty"`
	DeltaHighCount        *int                         `json:"delta_high_count,omitempty"`
	DeltaMediumCount      *int                         `json:"delta_medium_count,omitempty"`
	DeltaLowCount         *int                         `json:"delta_low_count,omitempty"`
}

const statusPageItemStatusUnscanned = "unscanned"

type StatusPageGitRepositorySourceHealth struct {
	RepositoryID    string     `json:"repository_id"`
	RepositoryName  string     `json:"repository_name"`
	DisplayOrder    int        `json:"display_order"`
	Status          string     `json:"status"`
	LatestRunID     string     `json:"latest_run_id,omitempty"`
	LatestRunStatus string     `json:"latest_run_status,omitempty"`
	SnapshotRunID   string     `json:"snapshot_run_id,omitempty"`
	CommitSHA       string     `json:"commit_sha,omitempty"`
	CompletedAt     *time.Time `json:"completed_at,omitempty"`
	ImageCount      int        `json:"image_count"`
	ErrorMessage    string     `json:"error_message,omitempty"`
}

type statusPageScanSummary struct {
	ScanID               string                       `json:"scan_id"`
	ImageName            string                       `json:"image_name"`
	ImageTag             string                       `json:"image_tag"`
	ScanStatus           string                       `json:"scan_status"`
	ExternalStatus       string                       `json:"external_status,omitempty"`
	ComplianceStatus     string                       `json:"compliance_status,omitempty"`
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
	Page                 *models.StatusPage                    `json:"page"`
	Items                []StatusPageItem                      `json:"items"`
	GitRepositorySources []StatusPageGitRepositorySourceHealth `json:"git_repository_sources,omitempty"`
	Info                 map[string]any                        `json:"info,omitempty"`
	Meta                 map[string]int64                      `json:"meta,omitempty"`
	Now                  time.Time                             `json:"now"`
	Links                map[string]string                     `json:"links,omitempty"`
	Extra                map[string][]string                   `json:"extra,omitempty"`
	Flags                map[string]bool                       `json:"flags,omitempty"`
	Stats                map[string]map[string]int             `json:"stats,omitempty"`
}

func ListStatusPages(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}

		var pages []models.StatusPage
		q := db.NewSelect().Model(&pages).Relation("GitRepositorySources").OrderExpr("updated_at DESC")
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

		page, targets, sources, updates, err := buildStatusPageModels(body, userID)
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
		if err := validateStatusPageGitRepositorySources(c.Request.Context(), db, page, sources); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
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
			if len(sources) > 0 {
				if _, err := tx.NewInsert().Model(&sources).Exec(ctx); err != nil {
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
		page.GitRepositorySources = sources
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

		sources, err := loadStatusPageGitRepositoryHealth(c.Request.Context(), db, page)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load Git repository source health"})
			return
		}
		c.JSON(http.StatusOK, statusPageResponse{Page: page, Items: items, GitRepositorySources: sources, Now: time.Now().UTC()})
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

		updated, targets, sources, updates, err := buildStatusPageModels(body, userID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		rebindStatusPageRelations(page.ID, targets, sources, updates)
		if err := validateStatusPageGitRepositorySources(c.Request.Context(), db, page, sources); err != nil {
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
			if _, err := tx.NewDelete().Model((*models.StatusPageGitRepositorySource)(nil)).Where("page_id = ?", page.ID).Exec(ctx); err != nil {
				return err
			}
			if len(sources) > 0 {
				if _, err := tx.NewInsert().Model(&sources).Exec(ctx); err != nil {
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
		page.GitRepositorySources = sources
		page.Updates = updates
		c.JSON(http.StatusOK, page)
	}
}

func rebindStatusPageRelations(pageID uuid.UUID, targets []models.StatusPageTarget, sources []models.StatusPageGitRepositorySource, updates []models.StatusPageUpdate) {
	for index := range targets {
		targets[index].PageID = pageID
	}
	for index := range sources {
		sources[index].PageID = pageID
	}
	for index := range updates {
		updates[index].PageID = pageID
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

func TransferStatusPageOwnership(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		pageID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status page ID"})
			return
		}
		page := &models.StatusPage{}
		if err := db.NewSelect().Model(page).Where("id = ?", pageID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "status page not found"})
			return
		}
		rawBody, err := c.GetRawData()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}
		var transferBody struct {
			OrgID string `json:"org_id"`
		}
		if err := json.Unmarshal(rawBody, &transferBody); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}
		targetOrgID, err := uuid.Parse(strings.TrimSpace(transferBody.OrgID))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
			return
		}
		if err := validateStatusPageGitRepositorySourcesForOwner(c.Request.Context(), db, page.ID, models.OwnerTypeOrg, nil, &targetOrgID); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(rawBody))
		if _, ok := resourceownership.TransferOrgOwnedResource(c, db, resourceownership.TransferParams{
			ResourceID: page.ID, OwnerType: page.OwnerType, OwnerOrgID: page.OwnerOrgID,
			ResourceTable: "status_pages", LinkTable: "org_status_pages", LinkResourceColumn: "status_page_id",
			ResourceName: "status_page", HasUpdatedAt: true,
		}); !ok {
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "ownership transferred"})
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

		sources, err := loadStatusPageGitRepositoryHealth(c.Request.Context(), db, page)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load Git repository source health"})
			return
		}
		c.JSON(http.StatusOK, statusPageResponse{Page: page, Items: items, GitRepositorySources: sources, Now: time.Now().UTC()})
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
		complianceStatuses, err := loadStatusPageComplianceStatuses(c.Request.Context(), db, page, []uuid.UUID{scan.ID})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan compliance status"})
			return
		}
		c.JSON(http.StatusOK, buildStatusPageScanSummary(scan, latestScanID, complianceStatuses[scan.ID]))
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
		historyStart := time.Now().UTC().AddDate(0, 0, -(statusPageHistoryDays - 1))
		historyQuery := db.NewSelect().
			Model(&scans).
			Where("image_name = ?", scan.ImageName).
			Where("image_tag = ?", scan.ImageTag).
			Where("created_at >= ?", historyStart).
			OrderExpr("created_at DESC").
			Limit(200)
		historyQuery = applyStatusPageScanScopeQuery(historyQuery, page, "scan")
		if trackedByGitRepositorySource, err := gitRepositorySourceIncludesScan(c.Request.Context(), db, page, scan.ID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to validate Git repository scan history"})
			return
		} else if trackedByGitRepositorySource {
			historyQuery = historyQuery.Where(gitRepositorySourceCurrentScanWhere(page, "scan"))
		}
		if err := historyQuery.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan history"})
			return
		}

		items := make([]statusPageScanSummary, 0, len(scans))
		scanIDs := make([]uuid.UUID, 0, len(scans))
		for i := range scans {
			scanIDs = append(scanIDs, scans[i].ID)
		}
		complianceStatuses, err := loadStatusPageComplianceStatuses(c.Request.Context(), db, page, scanIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan compliance statuses"})
			return
		}
		for i := range scans {
			if err := blockedpolicy.AttachScanDetails(c.Request.Context(), db, &scans[i]); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load blocked policy details"})
				return
			}
			items = append(items, buildStatusPageScanSummary(&scans[i], scans[0].ID, complianceStatuses[scans[i].ID]))
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
	if err := db.NewSelect().Model(&page.GitRepositorySources).
		Relation("Repository").
		Where("status_page_git_repository_source.page_id = ?", page.ID).
		OrderExpr("status_page_git_repository_source.display_order ASC").
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
	staticItems, err := loadStaticStatusPageItems(c, db, page)
	if err != nil {
		return nil, err
	}
	gitItems, err := loadGitRepositoryStatusPageItems(c.Request.Context(), db, page)
	if err != nil {
		return nil, err
	}
	for index := range gitItems {
		gitItems[index].DisplayOrder = index + 1
	}
	for index := range staticItems {
		staticItems[index].DisplayOrder = len(gitItems) + index + 1
	}
	items := append(gitItems, staticItems...)
	if items == nil {
		return []StatusPageItem{}, nil
	}
	return items, nil
}

func loadStaticStatusPageItems(c *gin.Context, db *bun.DB, page *models.StatusPage) ([]StatusPageItem, error) {

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

	scanIDs := make([]uuid.UUID, 0, len(items)+len(exactItems)+len(patternItems))
	for _, group := range [][]StatusPageItem{items, exactItems, patternItems} {
		for _, item := range group {
			if scanID, err := uuid.Parse(item.LatestScanID); err == nil {
				scanIDs = append(scanIDs, scanID)
			}
		}
	}
	complianceStatuses, err := loadStatusPageComplianceStatuses(c.Request.Context(), db, page, scanIDs)
	if err != nil {
		return nil, err
	}
	applyComplianceStatuses := func(group []StatusPageItem) {
		for index := range group {
			if scanID, err := uuid.Parse(group[index].LatestScanID); err == nil {
				group[index].ComplianceStatus = complianceStatuses[scanID]
			}
		}
	}
	applyComplianceStatuses(items)
	applyComplianceStatuses(exactItems)
	applyComplianceStatuses(patternItems)

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

func latestGitRepositorySnapshotRun(ctx context.Context, db *bun.DB, repositoryID uuid.UUID) (*models.GitRepositoryRun, error) {
	run := &models.GitRepositoryRun{}
	err := db.NewSelect().Model(run).
		Where("repository_id = ?", repositoryID).
		Where("status IN (?)", bun.In([]string{models.GitRepositoryRunCompleted, models.GitRepositoryRunPartial})).
		OrderExpr("COALESCE(completed_at, created_at) DESC").
		Limit(1).Scan(ctx)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return run, err
}

func loadGitRepositoryStatusPageItems(ctx context.Context, db *bun.DB, page *models.StatusPage) ([]StatusPageItem, error) {
	now := time.Now().UTC()
	items := make([]StatusPageItem, 0)
	for _, source := range page.GitRepositorySources {
		if source.Repository == nil {
			continue
		}
		snapshot, err := latestGitRepositorySnapshotRun(ctx, db, source.RepositoryID)
		if err != nil || snapshot == nil {
			if err != nil {
				return nil, err
			}
			continue
		}
		var images []models.GitRepositoryRunImage
		if err := db.NewSelect().Model(&images).Where("run_id = ?", snapshot.ID).Where("state != ?", "excluded").OrderExpr("full_ref ASC").Scan(ctx); err != nil {
			return nil, err
		}
		for _, image := range images {
			item := StatusPageItem{
				ImageName: image.ImageName, ImageTag: image.ImageTag, FullRef: image.FullRef,
				SourceType: "git_repository", SourceRepositoryID: source.RepositoryID.String(),
				SourceRepositoryName: source.Repository.Name, SourceRunID: snapshot.ID.String(), DiscoveryState: image.State,
				ObservedAt: snapshot.CreatedAt, FreshnessHours: int64(now.Sub(snapshot.CreatedAt).Hours()),
			}
			if snapshot.CompletedAt != nil {
				item.ObservedAt = *snapshot.CompletedAt
				item.FreshnessHours = int64(now.Sub(*snapshot.CompletedAt).Hours())
			}
			scanID := image.ScanID
			if scanID == nil {
				var previousID uuid.UUID
				err := db.NewSelect().TableExpr("git_repository_run_images AS ri").
					ColumnExpr("ri.scan_id").Join("JOIN git_repository_runs AS r ON r.id = ri.run_id").
					Where("r.repository_id = ?", source.RepositoryID).Where("ri.full_ref = ?", image.FullRef).
					Where("ri.scan_id IS NOT NULL").OrderExpr("ri.created_at DESC").Limit(1).Scan(ctx, &previousID)
				if err == nil {
					scanID = &previousID
				} else if err != sql.ErrNoRows {
					return nil, err
				}
			}
			if scanID == nil {
				if image.State == "failed" {
					item.ScanStatus, item.Status, item.ErrorMessage = models.ScanStatusFailed, "failed", "The image scan could not be created during repository discovery."
				} else {
					markStatusPageItemUnscanned(&item)
				}
				items = append(items, item)
				continue
			}
			scan := &models.Scan{}
			if err := db.NewSelect().Model(scan).Where("id = ?", *scanID).Scan(ctx); err != nil {
				if err == sql.ErrNoRows {
					markStatusPageItemUnscanned(&item)
					items = append(items, item)
					continue
				}
				return nil, err
			}
			item.LatestScanID, item.ScanStatus, item.ExternalStatus, item.ScanProvider, item.CurrentStep, item.ErrorMessage = scan.ID.String(), scan.Status, scan.ExternalStatus, scan.ScanProvider, scan.CurrentStep, scan.ErrorMessage
			item.StartedAt, item.CriticalCount, item.HighCount, item.MediumCount, item.LowCount = scan.StartedAt, scan.CriticalCount, scan.HighCount, scan.MediumCount, scan.LowCount
			if scan.CompletedAt != nil {
				item.ObservedAt = *scan.CompletedAt
				item.FreshnessHours = int64(now.Sub(*scan.CompletedAt).Hours())
			}
			item.Status = deriveStatus(page.StaleAfterHours, item)
			if item.ExternalStatus == models.ScanExternalStatusBlockedByXrayPolicy {
				item.BlockedPolicyDetails = scan.BlockedPolicyDetails
			}
			items = append(items, item)
		}
	}
	ids := make([]uuid.UUID, 0, len(items))
	for _, item := range items {
		if id, err := uuid.Parse(item.LatestScanID); err == nil {
			ids = append(ids, id)
		}
	}
	statuses, err := loadStatusPageComplianceStatuses(ctx, db, page, ids)
	if err != nil {
		return nil, err
	}
	for index := range items {
		if id, err := uuid.Parse(items[index].LatestScanID); err == nil {
			items[index].ComplianceStatus = statuses[id]
		}
	}
	return items, nil
}

func markStatusPageItemUnscanned(item *StatusPageItem) {
	item.ScanStatus = ""
	item.Status = statusPageItemStatusUnscanned
}

func loadStatusPageGitRepositoryHealth(ctx context.Context, db *bun.DB, page *models.StatusPage) ([]StatusPageGitRepositorySourceHealth, error) {
	health := make([]StatusPageGitRepositorySourceHealth, 0, len(page.GitRepositorySources))
	now := time.Now().UTC()
	for _, source := range page.GitRepositorySources {
		if source.Repository == nil {
			continue
		}
		entry := StatusPageGitRepositorySourceHealth{RepositoryID: source.RepositoryID.String(), RepositoryName: source.Repository.Name, DisplayOrder: source.DisplayOrder, Status: "not_run"}
		latest := &models.GitRepositoryRun{}
		err := db.NewSelect().Model(latest).Where("repository_id = ?", source.RepositoryID).OrderExpr("created_at DESC").Limit(1).Scan(ctx)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		latestMissing := err == sql.ErrNoRows
		if err == nil {
			entry.LatestRunID, entry.LatestRunStatus = latest.ID.String(), latest.Status
		}
		snapshot, err := latestGitRepositorySnapshotRun(ctx, db, source.RepositoryID)
		if err != nil {
			return nil, err
		}
		if snapshot != nil {
			entry.SnapshotRunID, entry.CommitSHA, entry.CompletedAt, entry.ImageCount = snapshot.ID.String(), snapshot.CommitSHA, snapshot.CompletedAt, snapshot.ImageCount
			if entry.CompletedAt == nil {
				entry.CompletedAt = &snapshot.CreatedAt
			}
		}
		switch {
		case latestMissing:
			entry.Status = "not_run"
		case latest.Status == models.GitRepositoryRunFailed || latest.Status == models.GitRepositoryRunCancelled:
			entry.Status = latest.Status
		case latest.Status == models.GitRepositoryRunPartial:
			entry.Status = "partial"
		case latest.Status == models.GitRepositoryRunQueued || latest.Status == models.GitRepositoryRunDiscovering || latest.Status == models.GitRepositoryRunScanning:
			entry.Status = latest.Status
		case entry.CompletedAt != nil && page.StaleAfterHours > 0 && now.Sub(*entry.CompletedAt) >= time.Duration(page.StaleAfterHours)*time.Hour:
			entry.Status = "stale"
		default:
			entry.Status = "healthy"
		}
		health = append(health, entry)
	}
	return health, nil
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
		tracked, err = gitRepositorySourceIncludesScan(c.Request.Context(), db, page, scan.ID)
		if err != nil {
			return nil, err
		}
	}
	if !tracked {
		return nil, fmt.Errorf("status page item not found")
	}

	return scan, nil
}

func gitRepositorySourceCurrentScanWhere(page *models.StatusPage, scanAlias string) string {
	return fmt.Sprintf(`EXISTS (
		SELECT 1 FROM status_page_git_repository_sources source
		JOIN git_repository_runs snapshot ON snapshot.repository_id = source.repository_id
		JOIN git_repository_run_images current_image ON current_image.run_id = snapshot.id AND current_image.state != 'excluded'
		JOIN git_repository_run_images linked_image ON linked_image.full_ref = current_image.full_ref
		JOIN git_repository_runs linked_run ON linked_run.id = linked_image.run_id AND linked_run.repository_id = source.repository_id
		WHERE source.page_id = '%s' AND snapshot.status IN ('completed', 'partial')
		AND snapshot.id = (SELECT latest_snapshot.id FROM git_repository_runs latest_snapshot WHERE latest_snapshot.repository_id = source.repository_id AND latest_snapshot.status IN ('completed', 'partial') ORDER BY COALESCE(latest_snapshot.completed_at, latest_snapshot.created_at) DESC LIMIT 1)
		AND linked_image.scan_id = %s.id
	)`, page.ID.String(), scanAlias)
}

func gitRepositorySourceIncludesScan(ctx context.Context, db *bun.DB, page *models.StatusPage, scanID uuid.UUID) (bool, error) {
	if len(page.GitRepositorySources) == 0 {
		return false, nil
	}
	return db.NewSelect().TableExpr("scans AS scan").Where("scan.id = ?", scanID).Where(gitRepositorySourceCurrentScanWhere(page, "scan")).Exists(ctx)
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

func buildStatusPageScanSummary(scan *models.Scan, latestScanID uuid.UUID, complianceStatus string) statusPageScanSummary {
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
		ComplianceStatus:     complianceStatus,
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

func loadStatusPageComplianceStatuses(
	ctx context.Context,
	db *bun.DB,
	page *models.StatusPage,
	scanIDs []uuid.UUID,
) (map[uuid.UUID]string, error) {
	statuses := make(map[uuid.UUID]string)
	if page.OwnerOrgID == nil || len(scanIDs) == 0 {
		return statuses, nil
	}

	var rows []struct {
		ScanID    uuid.UUID `bun:"scan_id"`
		HasFailed bool      `bun:"has_failed"`
	}
	if err := db.NewSelect().
		Table("compliance_results").
		Column("scan_id").
		ColumnExpr("BOOL_OR(status = 'fail') AS has_failed").
		Where("scan_id IN (?)", bun.In(scanIDs)).
		Where("org_id = ?", *page.OwnerOrgID).
		Group("scan_id").
		Scan(ctx, &rows); err != nil {
		return nil, err
	}

	for _, row := range rows {
		if row.HasFailed {
			statuses[row.ScanID] = "fail"
		} else {
			statuses[row.ScanID] = "pass"
		}
	}
	return statuses, nil
}

func buildStatusPageModels(body statusPagePayload, userID uuid.UUID) (*models.StatusPage, []models.StatusPageTarget, []models.StatusPageGitRepositorySource, []models.StatusPageUpdate, error) {
	visibility := strings.TrimSpace(strings.ToLower(body.Visibility))
	if visibility != models.StatusPageVisibilityPrivate && visibility != models.StatusPageVisibilityPublic && visibility != models.StatusPageVisibilityAuthenticated {
		return nil, nil, nil, nil, fmt.Errorf("visibility must be 'private', 'public', or 'authenticated'")
	}

	name := strings.TrimSpace(body.Name)
	if name == "" {
		return nil, nil, nil, nil, fmt.Errorf("name is required")
	}

	slug := normalizeSlug(body.Slug)
	if slug == "" {
		slug = normalizeSlug(name)
	}
	if slug == "" {
		return nil, nil, nil, nil, fmt.Errorf("slug must contain at least one alphanumeric character")
	}

	staleAfterHours := body.StaleAfterHours
	if staleAfterHours <= 0 {
		staleAfterHours = 72
	}

	imagePatterns, err := normalizeStatusPagePatterns(body.ImagePatterns)
	if err != nil {
		return nil, nil, nil, nil, err
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
			return nil, nil, nil, nil, fmt.Errorf("each target requires image_name and image_tag")
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
	sources := make([]models.StatusPageGitRepositorySource, 0, len(body.GitRepositorySources))
	seenSources := make(map[uuid.UUID]struct{}, len(body.GitRepositorySources))
	for index, source := range body.GitRepositorySources {
		repositoryID, err := uuid.Parse(strings.TrimSpace(source.RepositoryID))
		if err != nil {
			return nil, nil, nil, nil, fmt.Errorf("each Git repository source requires a valid repository_id")
		}
		if _, exists := seenSources[repositoryID]; exists {
			continue
		}
		seenSources[repositoryID] = struct{}{}
		displayOrder := source.DisplayOrder
		if displayOrder == 0 {
			displayOrder = index + 1
		}
		sources = append(sources, models.StatusPageGitRepositorySource{ID: uuid.New(), PageID: pageID, RepositoryID: repositoryID, DisplayOrder: displayOrder, CreatedAt: now})
	}
	if !page.IncludeAllTags && len(targets) == 0 && len(imagePatterns) == 0 && len(sources) == 0 {
		return nil, nil, nil, nil, fmt.Errorf("add an exact target, image regex, Git repository source, or enable include all tags")
	}

	updates := make([]models.StatusPageUpdate, 0, len(body.Updates))
	for _, update := range body.Updates {
		title := strings.TrimSpace(update.Title)
		body := strings.TrimSpace(update.Body)
		level := strings.TrimSpace(strings.ToLower(update.Level))
		if level == "" {
			level = "info"
		}
		if level != "info" && level != "maintenance" && level != "incident" {
			return nil, nil, nil, nil, fmt.Errorf("update level must be 'info', 'maintenance', or 'incident'")
		}
		if title == "" && body == "" {
			continue
		}
		if title == "" {
			title = defaultStatusPageUpdateTitle(level)
		}
		updates = append(updates, models.StatusPageUpdate{
			ID:              uuid.New(),
			PageID:          pageID,
			Title:           title,
			Body:            body,
			Level:           level,
			ActiveFrom:      update.ActiveFrom,
			ActiveUntil:     update.ActiveUntil,
			CreatedByUserID: userID,
			CreatedAt:       now,
			UpdatedAt:       now,
		})
	}

	return page, targets, sources, updates, nil
}

func validateStatusPageGitRepositorySources(ctx context.Context, db *bun.DB, page *models.StatusPage, sources []models.StatusPageGitRepositorySource) error {
	for _, source := range sources {
		repository := &models.GitRepository{}
		if err := db.NewSelect().Model(repository).Where("id = ?", source.RepositoryID).Scan(ctx); err != nil {
			if err == sql.ErrNoRows {
				return fmt.Errorf("Git repository source not found")
			}
			return err
		}
		if repository.OwnerType != page.OwnerType || (page.OwnerOrgID != nil && (repository.OwnerOrgID == nil || *repository.OwnerOrgID != *page.OwnerOrgID)) || (page.OwnerUserID != nil && (repository.OwnerUserID == nil || *repository.OwnerUserID != *page.OwnerUserID)) {
			return fmt.Errorf("Git repository source must have the same owner as the status page")
		}
	}
	return nil
}

func validateStatusPageGitRepositorySourcesForOwner(ctx context.Context, db *bun.DB, pageID uuid.UUID, ownerType string, ownerUserID, ownerOrgID *uuid.UUID) error {
	var sources []models.StatusPageGitRepositorySource
	if err := db.NewSelect().Model(&sources).Relation("Repository").Where("status_page_git_repository_source.page_id = ?", pageID).Scan(ctx); err != nil {
		return err
	}
	return validateStatusPageGitRepositorySources(ctx, db, &models.StatusPage{OwnerType: ownerType, OwnerUserID: ownerUserID, OwnerOrgID: ownerOrgID}, sources)
}

func defaultStatusPageUpdateTitle(level string) string {
	switch level {
	case "incident":
		return "Incident Notice"
	case "maintenance":
		return "Maintenance Notice"
	default:
		return "Status Update"
	}
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
