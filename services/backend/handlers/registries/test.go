package registries

import (
	"net/http"

	"justscan-backend/functions/authz"
	"justscan-backend/scanner"

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

		registry, _, _, ok := authz.LoadAuthorizedRegistry(c, db, registryID)
		if !ok {
			return
		}
		if err := scanner.ValidateProviderSelection(registry.ScanProvider); err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
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
