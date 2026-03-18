package registries

import (
	"fmt"
	"net/http"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/crypto"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// TestRegistry performs a health check against a registry's /v2/ endpoint and
// persists the result (health_status, health_message, last_health_check_at).
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

		// Decrypt the stored password (if any)
		decryptedPassword := ""
		if registry.Password != "" {
			key := crypto.KeyFromString(config.Config.Encryption.Key)
			decryptedPassword, err = crypto.Decrypt(key, registry.Password)
			if err != nil {
				// Non-fatal: proceed without credentials
				decryptedPassword = ""
			}
		}

		// Build the probe request
		probeURL := registry.URL + "/v2/"
		client := &http.Client{Timeout: 10 * time.Second}
		req, err := http.NewRequest(http.MethodGet, probeURL, nil)
		if err != nil {
			healthStatus := "unhealthy"
			healthMessage := fmt.Sprintf("failed to build request: %s", err.Error())
			now := time.Now()
			updateRegistryHealth(c, db, registry, registryID, healthStatus, healthMessage, now)
			return
		}

		switch registry.AuthType {
		case models.RegistryAuthBasic:
			req.SetBasicAuth(registry.Username, decryptedPassword)
		case models.RegistryAuthToken:
			req.Header.Set("Authorization", "Bearer "+decryptedPassword)
		// aws_ecr and none: no auth header
		}

		resp, err := client.Do(req)

		var healthStatus, healthMessage string
		now := time.Now()

		if err != nil {
			healthStatus = "unhealthy"
			healthMessage = err.Error()
		} else {
			resp.Body.Close()
			// 200 or 401 both mean the registry is alive (401 = needs auth, but responded)
			if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusUnauthorized {
				healthStatus = "healthy"
			} else {
				healthStatus = "unhealthy"
			}
			healthMessage = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}

		updateRegistryHealth(c, db, registry, registryID, healthStatus, healthMessage, now)
	}
}

func updateRegistryHealth(
	c *gin.Context,
	db *bun.DB,
	registry *models.Registry,
	registryID uuid.UUID,
	healthStatus, healthMessage string,
	now time.Time,
) {
	registry.HealthStatus = healthStatus
	registry.HealthMessage = healthMessage
	registry.LastHealthCheckAt = &now

	db.NewUpdate().Model(registry).
		Column("health_status", "health_message", "last_health_check_at").
		Where("id = ?", registryID).
		Exec(c.Request.Context()) //nolint:errcheck

	c.JSON(http.StatusOK, gin.H{
		"health_status":        registry.HealthStatus,
		"health_message":       registry.HealthMessage,
		"last_health_check_at": registry.LastHealthCheckAt,
	})
}
