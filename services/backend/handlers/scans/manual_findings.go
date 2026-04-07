package scans

import (
	"net/http"
	"time"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ListManualFindings(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		if _, _, _, ok := LoadAuthorizedScan(c, db, scanID); !ok {
			return
		}

		var findings []models.ManualFinding
		if err := db.NewSelect().Model(&findings).
			Where("scan_id = ?", scanID).
			OrderExpr("created_at ASC").
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load findings"})
			return
		}
		if findings == nil {
			findings = []models.ManualFinding{}
		}
		c.JSON(http.StatusOK, findings)
	}
}

type manualFindingRequest struct {
	VulnID           string  `json:"vuln_id" binding:"required"`
	Severity         string  `json:"severity" binding:"required"`
	PkgName          string  `json:"pkg_name"`
	InstalledVersion string  `json:"installed_version"`
	FixedVersion     string  `json:"fixed_version"`
	Title            string  `json:"title"`
	Description      string  `json:"description"`
	CVSSScore        float64 `json:"cvss_score"`
	Justification    string  `json:"justification"`
}

func CreateManualFinding(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		_, userID, _, ok := LoadAuthorizedScan(c, db, scanID)
		if !ok {
			return
		}

		var req manualFindingRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		now := time.Now()
		finding := &models.ManualFinding{
			ScanID:           scanID,
			VulnID:           req.VulnID,
			Severity:         req.Severity,
			PkgName:          req.PkgName,
			InstalledVersion: req.InstalledVersion,
			FixedVersion:     req.FixedVersion,
			Title:            req.Title,
			Description:      req.Description,
			CVSSScore:        req.CVSSScore,
			Justification:    req.Justification,
			CreatedBy:        userID,
			CreatedAt:        now,
			UpdatedAt:        now,
		}
		if _, err := db.NewInsert().Model(finding).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create finding"})
			return
		}
		c.JSON(http.StatusCreated, finding)
	}
}

func UpdateManualFinding(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		if _, _, _, ok := LoadAuthorizedScan(c, db, scanID); !ok {
			return
		}

		findingID, err := uuid.Parse(c.Param("fid"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid finding ID"})
			return
		}

		var req manualFindingRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if _, err := db.NewUpdate().Model((*models.ManualFinding)(nil)).
			Set("vuln_id = ?", req.VulnID).
			Set("severity = ?", req.Severity).
			Set("pkg_name = ?", req.PkgName).
			Set("installed_version = ?", req.InstalledVersion).
			Set("fixed_version = ?", req.FixedVersion).
			Set("title = ?", req.Title).
			Set("description = ?", req.Description).
			Set("cvss_score = ?", req.CVSSScore).
			Set("justification = ?", req.Justification).
			Set("updated_at = ?", time.Now()).
			Where("id = ?", findingID).
			Where("scan_id = ?", scanID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update finding"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

func DeleteManualFinding(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		if _, _, _, ok := LoadAuthorizedScan(c, db, scanID); !ok {
			return
		}

		findingID, err := uuid.Parse(c.Param("fid"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid finding ID"})
			return
		}

		if _, err := db.NewDelete().Model((*models.ManualFinding)(nil)).
			Where("id = ?", findingID).
			Where("scan_id = ?", scanID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete finding"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}
