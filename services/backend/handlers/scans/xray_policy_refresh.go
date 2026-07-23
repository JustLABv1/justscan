package scans

import (
	"context"
	"fmt"
	"net/http"

	"justscan-backend/compliance"
	"justscan-backend/functions/audit"
	"justscan-backend/functions/blockedpolicy"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func RefreshXrayPolicyViolations(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		scan, userID, _, ok := LoadAuthorizedScanForWrite(c, db, scanID)
		if !ok {
			return
		}
		if scan.ScanProvider != models.ScanProviderArtifactoryXray {
			c.JSON(http.StatusConflict, gin.H{"error": "Xray policy refresh is only available for Artifactory Xray scans"})
			return
		}
		if scan.Status == models.ScanStatusPending || scan.Status == models.ScanStatusRunning {
			c.JSON(http.StatusConflict, gin.H{"error": "wait for the Xray scan to finish before refreshing policy violations"})
			return
		}
		if scan.Status != models.ScanStatusCompleted && scan.Status != models.ScanStatusFailed {
			c.JSON(http.StatusConflict, gin.H{"error": "Xray policy refresh is only available for completed or failed scans"})
			return
		}

		result, err := scanner.RefreshXrayPolicyViolations(c.Request.Context(), db, scan)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}

		compliance.RunForScan(db, scan.ID)

		refreshed, err := loadEnrichedScan(c, db, scan.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		go audit.Write(context.Background(), db, userID.String(), "scan.xray_policy_refresh",
			fmt.Sprintf("Xray policy violations refreshed for %s:%s (id=%s, violations=%d)", refreshed.ImageName, refreshed.ImageTag, refreshed.ID, result.ViolationCount))

		c.JSON(http.StatusOK, gin.H{
			"scan":            refreshed,
			"violation_count": result.ViolationCount,
		})
	}
}

func loadEnrichedScan(c *gin.Context, db *bun.DB, scanID uuid.UUID) (*models.Scan, error) {
	ctx := c.Request.Context()
	scan := &models.Scan{}
	if err := db.NewSelect().Model(scan).Where("id = ?", scanID).Scan(ctx); err != nil {
		return nil, fmt.Errorf("failed to load refreshed scan")
	}

	var tags []models.Tag
	if err := db.NewSelect().
		TableExpr("tags AS t").
		ColumnExpr("t.*").
		Join("JOIN scan_tags st ON st.tag_id = t.id").
		Where("st.scan_id = ?", scanID).
		Scan(ctx, &tags); err == nil {
		scan.Tags = tags
	}

	var stepLogs []models.ScanStepLog
	if err := db.NewSelect().
		Model(&stepLogs).
		Where("scan_id = ?", scanID).
		OrderExpr("position ASC").
		Scan(ctx); err == nil {
		scan.StepLogs = stepLogs
	}

	if err := blockedpolicy.AttachScanDetails(ctx, db, scan); err != nil {
		return nil, fmt.Errorf("failed to load blocked policy details")
	}
	if orgID, ok := scopedOrgIDFromRequest(c); ok {
		summaries, err := buildScanComplianceSummaries(ctx, db, []uuid.UUID{scanID}, orgID)
		if err != nil {
			return nil, fmt.Errorf("failed to load compliance summary")
		}
		scan.ComplianceSummary = summaries[scanID]
	}

	return scan, nil
}
