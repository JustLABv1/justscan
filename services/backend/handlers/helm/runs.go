package helm

import (
	"context"
	"net/http"
	"sort"
	"strconv"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type helmRunRow struct {
	models.HelmScanRun `bun:",extend"`
	OwnerEmail         string `bun:"owner_email" json:"owner_email,omitempty"`
	OwnerUsername      string `bun:"owner_username" json:"owner_username,omitempty"`
}

type userIdentityRow struct {
	ID       uuid.UUID `bun:"id"`
	Email    string    `bun:"email"`
	Username string    `bun:"username"`
}

type HelmRunSummary struct {
	ID              uuid.UUID `json:"id"`
	ChartURL        string    `json:"chart_url"`
	ChartName       string    `json:"chart_name,omitempty"`
	ChartVersion    string    `json:"chart_version,omitempty"`
	Platform        string    `json:"platform,omitempty"`
	CreatedAt       string    `json:"created_at"`
	TotalImages     int       `json:"total_images"`
	CompletedImages int       `json:"completed_images"`
	FailedImages    int       `json:"failed_images"`
	ActiveImages    int       `json:"active_images"`
	CriticalCount   int       `json:"critical_count"`
	HighCount       int       `json:"high_count"`
	MediumCount     int       `json:"medium_count"`
	LowCount        int       `json:"low_count"`
	OwnerEmail      string    `json:"owner_email,omitempty"`
	OwnerUsername   string    `json:"owner_username,omitempty"`
}

type HelmRunItem struct {
	Key          string      `json:"key"`
	AttemptCount int         `json:"attempt_count"`
	LatestScan   models.Scan `json:"latest_scan"`
}

type HelmRunDetailResponse struct {
	Run   models.HelmScanRun `json:"run"`
	Items []HelmRunItem      `json:"items"`
}

func ListRuns(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}

		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 100 {
			limit = 20
		}
		offset := (page - 1) * limit

		restrictByRunIDs := !isAdmin || c.Query("scope") != ""
		visibleRunIDs, err := visibleHelmRunIDs(c, db, userID, isAdmin, accessibleOrgIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve Helm run visibility"})
			return
		}
		if restrictByRunIDs && len(visibleRunIDs) == 0 {
			c.JSON(http.StatusOK, gin.H{"data": []HelmRunSummary{}, "total": 0, "page": page, "limit": limit})
			return
		}

		countQuery := db.NewSelect().Model((*models.HelmScanRun)(nil))
		if restrictByRunIDs {
			countQuery = countQuery.Where("id IN (?)", bun.In(visibleRunIDs))
		}
		if chartURL := c.Query("chart_url"); chartURL != "" {
			countQuery = countQuery.Where("chart_url = ?", chartURL)
		}

		total, err := countQuery.Count(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count Helm runs"})
			return
		}

		var runs []models.HelmScanRun
		listQuery := db.NewSelect().Model(&runs)
		if restrictByRunIDs {
			listQuery = listQuery.Where("id IN (?)", bun.In(visibleRunIDs))
		}
		if chartURL := c.Query("chart_url"); chartURL != "" {
			listQuery = listQuery.Where("chart_url = ?", chartURL)
		}

		if err := listQuery.
			OrderExpr("created_at DESC").
			Limit(limit).
			Offset(offset).
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list Helm runs"})
			return
		}

		rows := make([]helmRunRow, 0, len(runs))
		ownerIDs := make([]uuid.UUID, 0, len(runs))
		seenOwnerIDs := make(map[uuid.UUID]struct{}, len(runs))
		for _, run := range runs {
			rows = append(rows, helmRunRow{HelmScanRun: run})
			if isAdmin && run.UserID != nil {
				if _, exists := seenOwnerIDs[*run.UserID]; !exists {
					seenOwnerIDs[*run.UserID] = struct{}{}
					ownerIDs = append(ownerIDs, *run.UserID)
				}
			}
		}

		ownerByID := make(map[uuid.UUID]userIdentityRow, len(ownerIDs))
		if isAdmin && len(ownerIDs) > 0 {
			var owners []userIdentityRow
			if err := db.NewSelect().
				Table("users").
				Column("id", "email", "username").
				Where("id IN (?)", bun.In(ownerIDs)).
				Scan(c.Request.Context(), &owners); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load Helm run owners"})
				return
			}
			for _, owner := range owners {
				ownerByID[owner.ID] = owner
			}
			for index := range rows {
				if rows[index].UserID == nil {
					continue
				}
				owner, ok := ownerByID[*rows[index].UserID]
				if !ok {
					continue
				}
				rows[index].OwnerEmail = owner.Email
				rows[index].OwnerUsername = owner.Username
			}
		}

		runIDs := make([]uuid.UUID, 0, len(rows))
		for _, row := range rows {
			runIDs = append(runIDs, row.ID)
		}

		scansByRun := make(map[uuid.UUID][]models.Scan, len(runIDs))
		if len(runIDs) > 0 {
			var scans []models.Scan
			if err := db.NewSelect().
				Model(&scans).
				Where("helm_scan_run_id IN (?)", bun.In(runIDs)).
				OrderExpr("created_at DESC").
				Scan(c.Request.Context()); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load Helm run scans"})
				return
			}
			for _, scan := range scans {
				if scan.HelmScanRunID == nil {
					continue
				}
				scansByRun[*scan.HelmScanRunID] = append(scansByRun[*scan.HelmScanRunID], scan)
			}
		}

		summaries := make([]HelmRunSummary, 0, len(rows))
		for _, row := range rows {
			items := buildHelmRunItems(scansByRun[row.ID])
			summary := HelmRunSummary{
				ID:            row.ID,
				ChartURL:      row.ChartURL,
				ChartName:     row.ChartName,
				ChartVersion:  row.ChartVersion,
				Platform:      row.Platform,
				CreatedAt:     row.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
				OwnerEmail:    row.OwnerEmail,
				OwnerUsername: row.OwnerUsername,
			}
			for _, item := range items {
				summary.TotalImages++
				summary.CriticalCount += item.LatestScan.CriticalCount
				summary.HighCount += item.LatestScan.HighCount
				summary.MediumCount += item.LatestScan.MediumCount
				summary.LowCount += item.LatestScan.LowCount
				switch item.LatestScan.Status {
				case models.ScanStatusCompleted:
					summary.CompletedImages++
				case models.ScanStatusFailed:
					summary.FailedImages++
				default:
					summary.ActiveImages++
				}
			}
			summaries = append(summaries, summary)
		}

		c.JSON(http.StatusOK, gin.H{
			"data":  summaries,
			"total": total,
			"page":  page,
			"limit": limit,
		})
	}
}

func GetRun(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}

		runID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid Helm run ID"})
			return
		}

		var run models.HelmScanRun
		q := db.NewSelect().Model(&run).Where("id = ?", runID)
		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Helm run not found"})
			return
		}
		if !isAdmin || c.Query("scope") != "" {
			visibleQuery := db.NewSelect().TableExpr("scans").ColumnExpr("1").Where("helm_scan_run_id = ?", runID)
			visibleQuery = authz.ApplyOwnershipVisibility(visibleQuery, "", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
			visibleQuery = authz.ApplyWorkspaceScope(c, visibleQuery, "", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
			visible, err := visibleQuery.Exists(c.Request.Context())
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve Helm run visibility"})
				return
			}
			if !visible {
				c.JSON(http.StatusNotFound, gin.H{"error": "Helm run not found"})
				return
			}
		}

		var scans []models.Scan
		scanQuery := db.NewSelect().
			Model(&scans).
			Where("helm_scan_run_id = ?", runID).
			OrderExpr("created_at DESC")
		scanQuery = authz.ApplyOwnershipVisibility(scanQuery, "", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
		scanQuery = authz.ApplyWorkspaceScope(c, scanQuery, "", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
		if err := scanQuery.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load Helm run scans"})
			return
		}

		items := buildHelmRunItems(scans)
		for index := range items {
			var tags []models.Tag
			db.NewSelect().
				TableExpr("tags AS t").
				ColumnExpr("t.*").
				Join("JOIN scan_tags st ON st.tag_id = t.id").
				Where("st.scan_id = ?", items[index].LatestScan.ID).
				Scan(c.Request.Context(), &tags) //nolint:errcheck
			items[index].LatestScan.Tags = tags
		}

		c.JSON(http.StatusOK, HelmRunDetailResponse{
			Run:   run,
			Items: items,
		})
	}
}

func DeleteRun(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		runID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid Helm run ID"})
			return
		}

		var run models.HelmScanRun
		if err := db.NewSelect().Model(&run).Where("id = ?", runID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Helm run not found"})
			return
		}

		var scans []models.Scan
		if err := db.NewSelect().
			Model(&scans).
			Where("helm_scan_run_id = ?", runID).
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load Helm run scans"})
			return
		}

		roles, err := authz.LoadUserOrgRoles(c.Request.Context(), db, userID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve organization access"})
			return
		}

		scanIDs := make([]uuid.UUID, 0, len(scans))
		for _, scan := range scans {
			if canDeleteHelmRunScan(c, scan, userID, isAdmin, roles) {
				scanIDs = append(scanIDs, scan.ID)
			}
		}
		if len(scanIDs) == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "Helm run not found"})
			return
		}

		deletedRun := false
		ctx := c.Request.Context()
		if err := db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
			if err := scanner.LockVulnerabilitiesForUpdate(ctx, tx, scanIDs); err != nil {
				return err
			}

			for _, table := range []string{
				"comments",
				"vulnerabilities",
				"sbom_components",
				"scan_tags",
				"org_scans",
				"scan_manual_findings",
				"scan_step_logs",
				"xray_request_logs",
				"xray_suppressions",
			} {
				tx.NewDelete().TableExpr(table).Where("scan_id IN (?)", bun.In(scanIDs)).Exec(ctx) //nolint:errcheck
			}

			if _, err := tx.NewDelete().
				Model((*models.Scan)(nil)).
				Where("id IN (?)", bun.In(scanIDs)).
				Exec(ctx); err != nil {
				return err
			}

			remaining, err := tx.NewSelect().
				Model((*models.Scan)(nil)).
				Where("helm_scan_run_id = ?", runID).
				Count(ctx)
			if err != nil {
				return err
			}

			if remaining == 0 {
				if _, err := tx.NewDelete().Model((*models.HelmScanRun)(nil)).Where("id = ?", runID).Exec(ctx); err != nil {
					return err
				}
				deletedRun = true
			}
			return nil
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete Helm run scans"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"deleted_scans": len(scanIDs), "deleted_run": deletedRun})
	}
}

func canDeleteHelmRunScan(c *gin.Context, scan models.Scan, userID uuid.UUID, isAdmin bool, roles map[uuid.UUID]string) bool {
	if isAdmin {
		return true
	}

	scope := c.Query("scope")
	if scope == "personal" {
		return scan.OwnerUserID != nil && *scan.OwnerUserID == userID
	}
	if scope != "" {
		orgID, err := uuid.Parse(scope)
		if err != nil {
			return false
		}
		if scan.OwnerOrgID == nil || *scan.OwnerOrgID != orgID {
			return false
		}
		return authz.HasOrgRoleAtLeast(roles, orgID, models.OrgRoleEditor)
	}

	if scan.UserID != nil && *scan.UserID == userID {
		return true
	}
	if scan.OwnerUserID != nil && *scan.OwnerUserID == userID {
		return true
	}
	if scan.OwnerOrgID == nil {
		return false
	}
	return authz.HasOrgRoleAtLeast(roles, *scan.OwnerOrgID, models.OrgRoleEditor)
}

func buildHelmRunItems(scans []models.Scan) []HelmRunItem {
	itemsByKey := make(map[string]*HelmRunItem, len(scans))
	for _, scan := range scans {
		key := helmRunItemKey(scan)
		if existing, ok := itemsByKey[key]; ok {
			existing.AttemptCount++
			if scan.CreatedAt.After(existing.LatestScan.CreatedAt) {
				existing.LatestScan = scan
			}
			continue
		}

		copyScan := scan
		itemsByKey[key] = &HelmRunItem{
			Key:          key,
			AttemptCount: 1,
			LatestScan:   copyScan,
		}
	}

	items := make([]HelmRunItem, 0, len(itemsByKey))
	for _, item := range itemsByKey {
		items = append(items, *item)
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].LatestScan.CreatedAt.Equal(items[j].LatestScan.CreatedAt) {
			return items[i].LatestScan.ID.String() > items[j].LatestScan.ID.String()
		}
		return items[i].LatestScan.CreatedAt.After(items[j].LatestScan.CreatedAt)
	})

	return items
}

func helmRunItemKey(scan models.Scan) string {
	if scan.HelmSourcePath != "" {
		return scan.HelmSourcePath + "|" + scan.ImageName + "|" + scan.ImageTag
	}
	return scan.ImageName + "|" + scan.ImageTag
}

func visibleHelmRunIDs(c *gin.Context, db *bun.DB, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID) ([]uuid.UUID, error) {
	type row struct {
		RunID uuid.UUID `bun:"helm_scan_run_id"`
	}

	var rows []row
	query := db.NewSelect().TableExpr("scans").ColumnExpr("DISTINCT helm_scan_run_id").Where("helm_scan_run_id IS NOT NULL")
	query = authz.ApplyOwnershipVisibility(query, "", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
	query = authz.ApplyWorkspaceScope(c, query, "", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
	if err := query.Scan(c.Request.Context(), &rows); err != nil {
		return nil, err
	}

	runIDs := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		runIDs = append(runIDs, row.RunID)
	}

	return runIDs, nil
}
