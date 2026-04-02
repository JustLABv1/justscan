package helm

import (
	"net/http"
	"sort"
	"strconv"

	authfuncs "justscan-backend/functions/auth"
	"justscan-backend/pkg/models"

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
		userID, err := authfuncs.GetUserIDFromToken(c.GetHeader("Authorization"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
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

		tokenType, _ := authfuncs.GetTypeFromToken(c.GetHeader("Authorization"))

		countQuery := db.NewSelect().Model((*models.HelmScanRun)(nil))
		if tokenType != "admin" {
			countQuery = countQuery.Where("user_id = ?", userID)
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
		if tokenType != "admin" {
			listQuery = listQuery.Where("user_id = ?", userID)
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
			if tokenType == "admin" && run.UserID != nil {
				if _, exists := seenOwnerIDs[*run.UserID]; !exists {
					seenOwnerIDs[*run.UserID] = struct{}{}
					ownerIDs = append(ownerIDs, *run.UserID)
				}
			}
		}

		ownerByID := make(map[uuid.UUID]userIdentityRow, len(ownerIDs))
		if tokenType == "admin" && len(ownerIDs) > 0 {
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
		userID, err := authfuncs.GetUserIDFromToken(c.GetHeader("Authorization"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		runID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid Helm run ID"})
			return
		}

		var run models.HelmScanRun
		q := db.NewSelect().Model(&run).Where("id = ?", runID)
		tokenType, _ := authfuncs.GetTypeFromToken(c.GetHeader("Authorization"))
		if tokenType != "admin" {
			q = q.Where("user_id = ?", userID)
		}
		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Helm run not found"})
			return
		}

		var scans []models.Scan
		if err := db.NewSelect().
			Model(&scans).
			Where("helm_scan_run_id = ?", runID).
			OrderExpr("created_at DESC").
			Scan(c.Request.Context()); err != nil {
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
