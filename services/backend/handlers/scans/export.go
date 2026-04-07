package scans

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ExportScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		format := c.DefaultQuery("format", "csv")
		ctx := c.Request.Context()

		scan, _, _, ok := LoadAuthorizedScan(c, db, scanID)
		if !ok {
			return
		}

		var vulns []models.Vulnerability
		if err := db.NewSelect().Model(&vulns).
			Where("scan_id = ?", scanID).
			OrderExpr("CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END").
			Scan(ctx); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load vulnerabilities"})
			return
		}

		// Load suppressions
		var suppressions []models.Suppression
		if scan.ImageDigest != "" {
			db.NewSelect().Model(&suppressions).Where("image_digest = ?", scan.ImageDigest).Scan(ctx) //nolint:errcheck
		}
		suppMap := make(map[string]models.Suppression)
		for _, s := range suppressions {
			suppMap[s.VulnID] = s
		}

		filename := fmt.Sprintf("justscan-%s-%s-%s",
			scan.ImageName, scan.ImageTag, time.Now().Format("2006-01-02"))

		switch format {
		case "json":
			type ExportRow struct {
				models.Vulnerability
				SuppressionStatus string `json:"suppression_status,omitempty"`
				Justification     string `json:"justification,omitempty"`
			}
			type JSONExport struct {
				Scan            *models.Scan `json:"scan"`
				Vulnerabilities []ExportRow  `json:"vulnerabilities"`
				ExportedAt      time.Time    `json:"exported_at"`
			}
			rows := make([]ExportRow, len(vulns))
			for i, v := range vulns {
				row := ExportRow{Vulnerability: v}
				if s, ok := suppMap[v.VulnID]; ok {
					row.SuppressionStatus = s.Status
					row.Justification = s.Justification
				}
				rows[i] = row
			}
			export := JSONExport{Scan: scan, Vulnerabilities: rows, ExportedAt: time.Now()}
			data, _ := json.MarshalIndent(export, "", "  ")
			c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.json"`, filename))
			c.Data(http.StatusOK, "application/json", data)

		default: // csv
			c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.csv"`, filename))
			c.Header("Content-Type", "text/csv")
			w := csv.NewWriter(c.Writer)
			w.Write([]string{"CVE ID", "Severity", "Package", "Installed Version", "Fixed Version", "CVSS Score", "Title", "Suppression Status", "Justification"}) //nolint:errcheck
			for _, v := range vulns {
				suppStatus := ""
				justification := ""
				if s, ok := suppMap[v.VulnID]; ok {
					suppStatus = s.Status
					justification = s.Justification
				}
				w.Write([]string{ //nolint:errcheck
					v.VulnID, v.Severity, v.PkgName, v.InstalledVersion, v.FixedVersion,
					fmt.Sprintf("%.1f", v.CVSSScore), v.Title, suppStatus, justification,
				})
			}
			w.Flush()
		}
	}
}
