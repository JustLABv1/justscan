package scans

import (
	"net/http"

	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func GetVulnerabilityContextAnalysis(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		scan, _, _, ok := LoadAuthorizedScan(c, db, scanID)
		if !ok {
			return
		}

		vulnerabilityID, err := uuid.Parse(c.Param("vulnerabilityId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vulnerability ID"})
			return
		}

		vulnerability := &models.Vulnerability{}
		if err := db.NewSelect().Model(vulnerability).
			Where("id = ? AND scan_id = ?", vulnerabilityID, scan.ID).
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "vulnerability not found"})
			return
		}

		analysis, err := scanner.GetVulnerabilityContextAnalysis(c.Request.Context(), db, scan, vulnerability)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load contextual analysis"})
			return
		}

		c.JSON(http.StatusOK, analysis)
	}
}
