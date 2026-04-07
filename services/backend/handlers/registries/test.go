package registries

import (
	"justscan-backend/pkg/models"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// TestRegistry performs a health check against either the registry /v2/
// endpoint or the configured Xray ping endpoint and persists the result.
func TestRegistry(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		registryID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry ID"})
			return
		}

		registry := &models.Registry{}
		if err := db.NewSelect().Model(registry).Where("id = ?", registryID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "registry not found"})
			return
		}
		if err := CheckAndPersistRegistryHealth(c.Request.Context(), db, registry); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"health_status":        registry.HealthStatus,
			"health_message":       registry.HealthMessage,
			"last_health_check_at": registry.LastHealthCheckAt,
		})
	}
}
