package public

import (
	"net/http"
	"sort"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type publicHelmRunItem struct {
	Key          string      `json:"key"`
	AttemptCount int         `json:"attempt_count"`
	LatestScan   models.Scan `json:"latest_scan"`
}

type publicHelmRunDetailResponse struct {
	Run   models.HelmScanRun  `json:"run"`
	Items []publicHelmRunItem `json:"items"`
}

func GetPublicHelmRun(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		runID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid Helm run ID"})
			return
		}

		var run models.HelmScanRun
		if err := db.NewSelect().
			Model(&run).
			Where("id = ?", runID).
			Where("user_id IS NULL").
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Helm run not found"})
			return
		}

		var scans []models.Scan
		if err := db.NewSelect().
			Model(&scans).
			Where("helm_scan_run_id = ?", runID).
			Where("user_id IS NULL").
			OrderExpr("created_at DESC").
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load Helm run scans"})
			return
		}

		c.JSON(http.StatusOK, publicHelmRunDetailResponse{
			Run:   run,
			Items: buildPublicHelmRunItems(scans),
		})
	}
}

func buildPublicHelmRunItems(scans []models.Scan) []publicHelmRunItem {
	itemsByKey := make(map[string]*publicHelmRunItem, len(scans))
	for _, scan := range scans {
		key := publicHelmRunItemKey(scan)
		if existing, ok := itemsByKey[key]; ok {
			existing.AttemptCount++
			if scan.CreatedAt.After(existing.LatestScan.CreatedAt) {
				existing.LatestScan = scan
			}
			continue
		}

		copyScan := scan
		itemsByKey[key] = &publicHelmRunItem{
			Key:          key,
			AttemptCount: 1,
			LatestScan:   copyScan,
		}
	}

	items := make([]publicHelmRunItem, 0, len(itemsByKey))
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

func publicHelmRunItemKey(scan models.Scan) string {
	if scan.HelmSourcePath != "" {
		return scan.HelmSourcePath + "|" + scan.ImageName + "|" + scan.ImageTag
	}
	return scan.ImageName + "|" + scan.ImageTag
}
