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

	setting := &models.SystemSetting{
		Key:       "public_scan_enabled",
		Value:     value,
		UpdatedAt: time.Now(),
	}

	if _, err := db.NewInsert().Model(setting).
		On("CONFLICT (key) DO UPDATE").
		Set("value = EXCLUDED.value, updated_at = EXCLUDED.updated_at").
		Exec(c.Request.Context()); err != nil {
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

	setting := &models.SystemSetting{
		Key:       "public_scan_rate_limit",
		Value:     strconv.Itoa(req.Limit),
		UpdatedAt: time.Now(),
	}

	if _, err := db.NewInsert().Model(setting).
		On("CONFLICT (key) DO UPDATE").
		Set("value = EXCLUDED.value, updated_at = EXCLUDED.updated_at").
		Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update rate limit"})
		return
	}

	middlewares.SetPublicScanRateLimit(req.Limit)

	c.JSON(http.StatusOK, gin.H{"limit": req.Limit})
}
