package registries

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/crypto"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

const autoHealthCheckInterval = 15 * time.Minute

var (
	healthChecksCancel context.CancelFunc
	healthChecksDone   chan struct{}
)

func StartHealthChecks(db *bun.DB) {
	if healthChecksCancel != nil {
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	healthChecksCancel = cancel
	healthChecksDone = make(chan struct{})

	go func() {
		defer close(healthChecksDone)
		runHealthChecks(ctx, db)
		ticker := time.NewTicker(autoHealthCheckInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runHealthChecks(ctx, db)
			}
		}
	}()

	log.Infof("registry health checks started (interval=%s)", autoHealthCheckInterval)
}

func StopHealthChecks() {
	if healthChecksCancel == nil {
		return
	}

	healthChecksCancel()
	select {
	case <-healthChecksDone:
	case <-time.After(5 * time.Second):
		log.Warn("registry health checks did not stop within 5s")
	}

	healthChecksCancel = nil
	healthChecksDone = nil
}

func runHealthChecks(ctx context.Context, db *bun.DB) {
	var registries []models.Registry
	if err := db.NewSelect().Model(&registries).Scan(ctx); err != nil {
		log.Errorf("registry health checks: failed to list registries: %v", err)
		return
	}

	for i := range registries {
		registry := &registries[i]
		if err := CheckAndPersistRegistryHealth(ctx, db, registry); err != nil {
			log.Warnf("registry health checks: %s failed: %v", registry.Name, err)
		}
	}

	if len(registries) > 0 {
		log.Infof("registry health checks: completed for %d registries", len(registries))
	}
}

func CheckAndPersistRegistryHealth(ctx context.Context, db *bun.DB, registry *models.Registry) error {
	status, message, checkedAt := CheckRegistryHealth(ctx, registry)
	registry.HealthStatus = status
	registry.HealthMessage = message
	registry.LastHealthCheckAt = &checkedAt

	_, err := db.NewUpdate().Model(registry).
		Column("health_status", "health_message", "last_health_check_at").
		Where("id = ?", registry.ID).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to persist registry health: %w", err)
	}
	return nil
}

func CheckRegistryHealth(ctx context.Context, registry *models.Registry) (string, string, time.Time) {
	now := time.Now()

	if registry.ScanProvider == models.ScanProviderArtifactoryXray {
		client, err := scanner.NewRegistryXrayTestClient(registry)
		if err != nil {
			return "unhealthy", err.Error(), now
		}
		if err := client.Ping(ctx); err != nil {
			return "unhealthy", err.Error(), now
		}
		return "healthy", "Xray ping succeeded", now
	}

	decryptedPassword := ""
	if registry.Password != "" {
		key := crypto.KeyFromString(config.Config.Encryption.Key)
		decryptedPassword, _ = crypto.Decrypt(key, registry.Password)
	}

	probeURL := registry.URL + "/v2/"
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, probeURL, nil)
	if err != nil {
		return "unhealthy", fmt.Sprintf("failed to build request: %s", err.Error()), now
	}

	switch registry.AuthType {
	case models.RegistryAuthBasic:
		req.SetBasicAuth(registry.Username, decryptedPassword)
	case models.RegistryAuthToken:
		req.Header.Set("Authorization", "Bearer "+decryptedPassword)
	}

	resp, err := client.Do(req)
	if err != nil {
		return "unhealthy", err.Error(), now
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusUnauthorized {
		return "healthy", fmt.Sprintf("HTTP %d", resp.StatusCode), now
	}
	return "unhealthy", fmt.Sprintf("HTTP %d", resp.StatusCode), now
}
