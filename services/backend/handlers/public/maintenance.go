package public

import (
	"net/http"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

const defaultMaintenanceMessage = "JustScan is currently undergoing maintenance. Please check back shortly."

// GetMaintenanceSettings returns the public maintenance mode state for frontend routing.
func GetMaintenanceSettings(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		settings := make([]models.SystemSetting, 0)
		db.NewSelect().Model(&settings).
			Where("key IN (?)", bun.In([]string{"maintenance.enabled", "maintenance.message"})).
			Scan(c.Request.Context()) //nolint:errcheck

		values := make(map[string]string, len(settings))
		for _, setting := range settings {
			values[setting.Key] = setting.Value
		}

		message := values["maintenance.message"]
		if message == "" {
			message = defaultMaintenanceMessage
		}

		c.JSON(http.StatusOK, gin.H{
			"enabled": values["maintenance.enabled"] == "true",
			"message": message,
		})
	}
}
