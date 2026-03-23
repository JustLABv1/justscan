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
