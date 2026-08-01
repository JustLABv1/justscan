package vulnkb

import (
	"net/http"
	"strconv"
	"time"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func GetKBEntry(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		vulnID := c.Param("vulnId")
		if vulnID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "vuln_id is required"})
			return
		}
		entry := &models.VulnKBEntry{}
		if err := db.NewSelect().Model(entry).Where("vuln_id = ?", vulnID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "no KB entry found"})
			return
		}
		if err := hydrateKBHistorySummary(c, db, []*models.VulnKBEntry{entry}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load KB history summary"})
			return
		}
		c.JSON(http.StatusOK, entry)
	}
}

func ListKBEntries(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		search := c.Query("q")
		severity := c.Query("severity")
		exploit := c.Query("exploit")
		minCvssStr := c.Query("min_cvss")
		publishedAfter := c.Query("published_after")

		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 200 {
			limit = 50
		}
		offset := (page - 1) * limit

		base := db.NewSelect().Model((*models.VulnKBEntry)(nil))
		if search != "" {
			base = base.Where("vuln_id ILIKE ? OR description ILIKE ?", "%"+search+"%", "%"+search+"%")
		}
		if severity != "" {
			base = base.Where("severity = ?", severity)
		}
		if exploit == "true" {
			base = base.Where("exploit_available = ?", true)
		}
		if minCvssStr != "" {
			if minCvssFloat, err := strconv.ParseFloat(minCvssStr, 64); err == nil && minCvssFloat > 0 {
				base = base.Where("cvss_score >= ?", minCvssFloat)
			}
		}
		if publishedAfter != "" {
			base = base.Where("published_date >= ?::timestamptz", publishedAfter)
		}

		total, err := base.Count(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count KB entries"})
			return
		}

		var entries []models.VulnKBEntry
		if err := base.OrderExpr("cvss_score DESC NULLS LAST, vuln_id").
			Limit(limit).Offset(offset).
			Scan(c.Request.Context(), &entries); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query KB"})
			return
		}
		entryPointers := make([]*models.VulnKBEntry, len(entries))
		for i := range entries {
			entryPointers[i] = &entries[i]
		}
		if err := hydrateKBHistorySummary(c, db, entryPointers); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load KB history summary"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": entries, "total": total})
	}
}

type kbHistorySummaryRow struct {
	VulnID            string     `bun:"vuln_id"`
	HistoryEventCount int        `bun:"history_event_count"`
	LastChangeAt      *time.Time `bun:"last_change_at"`
}

type kbLastChangeRow struct {
	VulnID           string    `bun:"vuln_id"`
	EventName        string    `bun:"event_name"`
	Source           string    `bun:"source"`
	SourceIdentifier string    `bun:"source_identifier"`
	ObservedAt       time.Time `bun:"observed_at"`
}

func hydrateKBHistorySummary(c *gin.Context, db *bun.DB, entries []*models.VulnKBEntry) error {
	if len(entries) == 0 {
		return nil
	}

	vulnIDs := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry != nil && entry.VulnID != "" {
			vulnIDs = append(vulnIDs, entry.VulnID)
		}
	}
	if len(vulnIDs) == 0 {
		return nil
	}

	var rows []kbHistorySummaryRow
	if err := db.NewSelect().
		TableExpr("vulnerability_intelligence_change_events").
		ColumnExpr("vuln_id, COUNT(*) AS history_event_count, MAX(observed_at) AS last_change_at").
		Where("vuln_id IN (?)", bun.In(vulnIDs)).
		GroupExpr("vuln_id").
		Scan(c.Request.Context(), &rows); err != nil {
		return err
	}

	byVulnID := make(map[string]kbHistorySummaryRow, len(rows))
	for _, row := range rows {
		byVulnID[row.VulnID] = row
	}

	var latestRows []kbLastChangeRow
	if err := db.NewSelect().
		TableExpr("vulnerability_intelligence_change_events").
		ColumnExpr("vuln_id, event_name, source, source_identifier, observed_at").
		Where("vuln_id IN (?)", bun.In(vulnIDs)).
		DistinctOn("vuln_id").
		OrderExpr("vuln_id, observed_at DESC, id DESC").
		Scan(c.Request.Context(), &latestRows); err != nil {
		return err
	}
	latestByVulnID := make(map[string]kbLastChangeRow, len(latestRows))
	for _, row := range latestRows {
		latestByVulnID[row.VulnID] = row
	}

	for _, entry := range entries {
		if entry == nil {
			continue
		}
		if row, ok := byVulnID[entry.VulnID]; ok {
			entry.HistoryEventCount = row.HistoryEventCount
			entry.LastChangeAt = row.LastChangeAt
		}
		if row, ok := latestByVulnID[entry.VulnID]; ok {
			entry.LastChange = &models.KBLastChange{
				EventName:        row.EventName,
				Source:           row.Source,
				SourceIdentifier: row.SourceIdentifier,
				ObservedAt:       row.ObservedAt,
			}
		}
	}
	return nil
}
