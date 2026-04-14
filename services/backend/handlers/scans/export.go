package scans

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	effectivesuppressions "justscan-backend/functions/suppressions"
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

		if _, err := effectivesuppressions.ApplyEffectiveSuppressions(ctx, db, scan, vulns); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve suppressions"})
			return
		}

		filename := fmt.Sprintf("justscan-%s-%s-%s",
			scan.ImageName, scan.ImageTag, time.Now().Format("2006-01-02"))

		switch format {
		case "json":
			type ExportRow struct {
				models.Vulnerability
				SuppressionStatus string `json:"suppression_status,omitempty"`
				Justification     string `json:"justification,omitempty"`
				SuppressionSource string `json:"suppression_source,omitempty"`
				ReadOnly          bool   `json:"suppression_read_only,omitempty"`
				XrayPolicyName    string `json:"xray_policy_name,omitempty"`
				XrayWatchName     string `json:"xray_watch_name,omitempty"`
			}
			type JSONExport struct {
				Scan            *models.Scan `json:"scan"`
				Vulnerabilities []ExportRow  `json:"vulnerabilities"`
				ExportedAt      time.Time    `json:"exported_at"`
			}
			rows := make([]ExportRow, len(vulns))
			for i, v := range vulns {
				row := ExportRow{Vulnerability: v}
				if v.Suppression != nil {
					row.SuppressionStatus = v.Suppression.Status
					row.Justification = v.Suppression.Justification
					row.SuppressionSource = v.Suppression.Source
					row.ReadOnly = v.Suppression.ReadOnly
					row.XrayPolicyName = v.Suppression.XrayPolicyName
					row.XrayWatchName = v.Suppression.XrayWatchName
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
			w.Write([]string{"CVE ID", "Severity", "Package", "Installed Version", "Fixed Version", "CVSS Score", "Title", "Suppression Status", "Suppression Source", "Justification", "Xray Policy", "Xray Watch"}) //nolint:errcheck
			for _, v := range vulns {
				suppStatus := ""
				suppSource := ""
				justification := ""
				xrayPolicy := ""
				xrayWatch := ""
				if v.Suppression != nil {
					suppStatus = v.Suppression.Status
					suppSource = v.Suppression.Source
					justification = v.Suppression.Justification
					xrayPolicy = v.Suppression.XrayPolicyName
					xrayWatch = v.Suppression.XrayWatchName
				}
				w.Write([]string{ //nolint:errcheck
					v.VulnID, v.Severity, v.PkgName, v.InstalledVersion, v.FixedVersion,
					fmt.Sprintf("%.1f", v.CVSSScore), v.Title, suppStatus, suppSource, justification, xrayPolicy, xrayWatch,
				})
			}
			w.Flush()
		}
	}
}
