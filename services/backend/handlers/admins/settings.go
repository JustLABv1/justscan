package admins

import (
	"net/http"
	"time"

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
