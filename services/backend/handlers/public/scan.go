package public

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"justscan-backend/functions/audit"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

func isPublicScanEnabled(ctx context.Context, db *bun.DB) bool {
	var setting models.SystemSetting
	if err := db.NewSelect().Model(&setting).Where("key = ?", "public_scan_enabled").Scan(ctx); err != nil {
		return false
	}
	return setting.Value == "true"
}

// GetPublicSettings returns whether public scanning is enabled and the rate limit.
func GetPublicSettings(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		enabled := isPublicScanEnabled(c.Request.Context(), db)

		var limitSetting models.SystemSetting
		db.NewSelect().Model(&limitSetting).Where("key = ?", "public_scan_rate_limit").Scan(c.Request.Context()) //nolint:errcheck
		limit := 5
		if limitSetting.Value != "" {
			if v, err := strconv.Atoi(limitSetting.Value); err == nil && v > 0 {
				limit = v
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"enabled":             enabled,
			"rate_limit_per_hour": limit,
		})
	}
}

// CreatePublicScan creates a scan without requiring authentication.
func CreatePublicScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !isPublicScanEnabled(c.Request.Context(), db) {
			c.JSON(http.StatusForbidden, gin.H{"error": "public scanning is currently disabled by the administrator"})
			return
		}

		var req struct {
			Image    string `json:"image" binding:"required"`
			Tag      string `json:"tag" binding:"required"`
			Platform string `json:"platform"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		scan := &models.Scan{
			ImageName: req.Image,
			ImageTag:  req.Tag,
			Platform:  req.Platform,
			Status:    models.ScanStatusPending,
			CreatedAt: time.Now(),
			// UserID is nil — this marks it as a public scan
		}
		if _, err := db.NewInsert().Model(scan).Exec(c.Request.Context()); err != nil {
			log.Errorf("CreatePublicScan DB insert error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create scan"})
			return
		}

		scanner.EnqueueScan(scan.ID, db, nil, req.Platform)

		clientIP := c.ClientIP()
		go audit.Write(context.Background(), db, "public", "scan.public.create",
			fmt.Sprintf("Public scan created for %s:%s (id=%s, ip=%s)", req.Image, req.Tag, scan.ID, clientIP))

		c.JSON(http.StatusCreated, scan)
	}
}

// ReScanPublic creates a new anonymous scan using the same image/tag/platform as an existing public scan.
func ReScanPublic(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !isPublicScanEnabled(c.Request.Context(), db) {
			c.JSON(http.StatusForbidden, gin.H{"error": "public scanning is currently disabled by the administrator"})
			return
		}

		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		var orig models.Scan
		if err := db.NewSelect().Model(&orig).
			Where("id = ? AND user_id IS NULL", scanID).
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
			return
		}

		newScan := &models.Scan{
			ImageName:        orig.ImageName,
			ImageTag:         orig.ImageTag,
			Platform:         orig.Platform,
			HelmScanRunID:    orig.HelmScanRunID,
			HelmChart:        orig.HelmChart,
			HelmChartName:    orig.HelmChartName,
			HelmChartVersion: orig.HelmChartVersion,
			HelmSourcePath:   orig.HelmSourcePath,
			Status:           models.ScanStatusPending,
			CreatedAt:        time.Now(),
		}
		if _, err := db.NewInsert().Model(newScan).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create rescan"})
			return
		}

		scanner.EnqueueScan(newScan.ID, db, nil, orig.Platform)

		clientIP := c.ClientIP()
		go audit.Write(context.Background(), db, "public", "scan.public.rescan",
			fmt.Sprintf("Public rescan created for %s:%s (original=%s, new=%s, ip=%s)", orig.ImageName, orig.ImageTag, orig.ID, newScan.ID, clientIP))

		c.JSON(http.StatusCreated, newScan)
	}
}

// GetPublicScan returns scan status and summary for a public (anonymous) scan.
func GetPublicScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		var scan models.Scan
		if err := db.NewSelect().Model(&scan).
			Where("id = ? AND user_id IS NULL", id).
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
			return
		}

		c.JSON(http.StatusOK, scan)
	}
}

// ListPublicVulnerabilities lists vulnerabilities for a public scan with filtering.
func ListPublicVulnerabilities(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		// Verify this is a public (anonymous) scan
		var scan models.Scan
		if err := db.NewSelect().Model(&scan).Column("id", "image_digest").
			Where("id = ? AND user_id IS NULL", scanID).
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
			return
		}

		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 500 {
			limit = 50
		}
		offset := (page - 1) * limit

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
		if s := c.Query("sort_by"); s != "" {
			if _, ok := allowedCols[s]; ok {
				sortCol = s
			}
		}
		if d := c.Query("sort_dir"); d == "desc" {
			sortDir = "desc"
		}
		orderExpr := allowedCols[sortCol] + " " + sortDir
		if sortCol != "vuln_id" {
			orderExpr += ", vuln_id asc"
		}

		var vulns []models.Vulnerability
		q := db.NewSelect().Model(&vulns).
			Where("scan_id = ?", scanID).
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

		c.JSON(http.StatusOK, gin.H{
			"data":  vulns,
			"total": total,
			"page":  page,
			"limit": limit,
		})
	}
}
