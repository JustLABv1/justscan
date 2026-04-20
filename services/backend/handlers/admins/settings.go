package admins

import (
	"net/http"
	"strconv"
	"time"

	"justscan-backend/middlewares"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func upsertSystemSetting(c *gin.Context, db *bun.DB, key string, value string) error {
	setting := &models.SystemSetting{
		Key:       key,
		Value:     value,
		UpdatedAt: time.Now(),
	}

	_, err := db.NewInsert().Model(setting).
		On("CONFLICT (key) DO UPDATE").
		Set("value = EXCLUDED.value, updated_at = EXCLUDED.updated_at").
		Exec(c.Request.Context())

	return err
}

// GetSettings returns all system settings.
func GetSettings(c *gin.Context, db *bun.DB) {
	var settings []models.SystemSetting
	db.NewSelect().Model(&settings).Scan(c.Request.Context()) //nolint:errcheck

	result := make(map[string]string)
	for _, s := range settings {
		result[s.Key] = s.Value
	}
	c.JSON(http.StatusOK, result)
}

// UpdatePublicScanEnabled enables or disables the public scan feature.
func UpdatePublicScanEnabled(c *gin.Context, db *bun.DB) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	value := "false"
	if req.Enabled {
		value = "true"
	}

	if err := upsertSystemSetting(c, db, "public_scan_enabled", value); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update setting"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"enabled": req.Enabled})
}

// UpdateRateLimit updates the public scan rate limit per hour.
func UpdateRateLimit(c *gin.Context, db *bun.DB) {
	var req struct {
		Limit int `json:"limit"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Limit < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be a positive integer"})
		return
	}

	if err := upsertSystemSetting(c, db, "public_scan_rate_limit", strconv.Itoa(req.Limit)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update rate limit"})
		return
	}

	middlewares.SetPublicScanRateLimit(req.Limit)

	c.JSON(http.StatusOK, gin.H{"limit": req.Limit})
}

// UpdateRegistrationRateLimit updates the registration rate limit per IP per hour.
func UpdateRegistrationRateLimit(c *gin.Context, db *bun.DB) {
	var req struct {
		Limit int `json:"limit"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Limit < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be a positive integer"})
		return
	}

	if err := upsertSystemSetting(c, db, "register_rate_limit", strconv.Itoa(req.Limit)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update registration rate limit"})
		return
	}

	middlewares.SetAuthRegisterRateLimit(req.Limit)

	c.JSON(http.StatusOK, gin.H{"limit": req.Limit})
}

// UpdateAPILogRetention updates the retention period (in days) for api_request_logs.
func UpdateAPILogRetention(c *gin.Context, db *bun.DB) {
	var req struct {
		Days int `json:"days"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Days < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "days must be a non-negative integer"})
		return
	}
	if err := upsertSystemSetting(c, db, "api_log_retention_days", strconv.Itoa(req.Days)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update API log retention"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"days": req.Days})
}

// UpdateXRayLogRetention updates the retention period (in days) for xray_request_logs.
func UpdateXRayLogRetention(c *gin.Context, db *bun.DB) {
	var req struct {
		Days int `json:"days"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Days < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "days must be a non-negative integer"})
		return
	}
	if err := upsertSystemSetting(c, db, "xray_log_retention_days", strconv.Itoa(req.Days)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update xRay log retention"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"days": req.Days})
}

// UpdateScannerSettings updates DB-backed scanner settings.
func UpdateScannerSettings(c *gin.Context, db *bun.DB) {
	var req struct {
		EnableTrivy               *bool `json:"enable_trivy"`
		EnableGrype               *bool `json:"enable_grype"`
		Concurrency               *int  `json:"concurrency"`
		TimeoutSeconds            *int  `json:"timeout_seconds"`
		DBMaxAgeHours             *int  `json:"db_max_age_hours"`
		EnableOSVJavaAugmentation *bool `json:"enable_osv_java_augmentation"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	boolStr := func(v bool) string {
		if v {
			return "true"
		}
		return "false"
	}
	settings := map[string]string{}
	if req.EnableTrivy != nil {
		settings["scanner.enable_trivy"] = boolStr(*req.EnableTrivy)
	}
	if req.EnableGrype != nil {
		settings["scanner.enable_grype"] = boolStr(*req.EnableGrype)
	}
	if req.Concurrency != nil {
		if *req.Concurrency < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "concurrency must be >= 1"})
			return
		}
		settings["scanner.concurrency"] = strconv.Itoa(*req.Concurrency)
	}
	if req.TimeoutSeconds != nil {
		settings["scanner.timeout_seconds"] = strconv.Itoa(*req.TimeoutSeconds)
	}
	if req.DBMaxAgeHours != nil {
		settings["scanner.db_max_age_hours"] = strconv.Itoa(*req.DBMaxAgeHours)
	}
	if req.EnableOSVJavaAugmentation != nil {
		settings["scanner.enable_osv_java_augmentation"] = boolStr(*req.EnableOSVJavaAugmentation)
	}
	for key, value := range settings {
		if err := upsertSystemSetting(c, db, key, value); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update setting: " + key})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"updated": settings})
}

// UpdateAuthSettings updates DB-backed authentication settings.
func UpdateAuthSettings(c *gin.Context, db *bun.DB) {
	var req struct {
		LocalAuthEnabled *bool `json:"local_auth_enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.LocalAuthEnabled == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no settings provided"})
		return
	}
	value := "false"
	if *req.LocalAuthEnabled {
		value = "true"
	}
	if err := upsertSystemSetting(c, db, "auth.local_enabled", value); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update auth settings"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"local_auth_enabled": *req.LocalAuthEnabled})
}
