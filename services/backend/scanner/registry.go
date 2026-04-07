package scanner

import (
	"context"
	"fmt"
	"strings"

	"justscan-backend/config"
	"justscan-backend/pkg/crypto"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// ResolveRegistryForScan returns the registry to use for a scan request and
// any auth environment variables required for Trivy-backed execution.
func ResolveRegistryForScan(ctx context.Context, db *bun.DB, imageName string, registryID *uuid.UUID) (*models.Registry, []string, error) {
	if registryID != nil {
		registry := &models.Registry{}
		if err := db.NewSelect().Model(registry).Where("id = ?", *registryID).Scan(ctx); err != nil {
			return nil, nil, fmt.Errorf("failed to load registry %s: %w", registryID.String(), err)
		}

		envVars, err := buildRegistryEnv(registry)
		if err != nil {
			return nil, nil, err
		}

		return registry, envVars, nil
	}

	var registries []models.Registry
	if err := db.NewSelect().Model(&registries).OrderExpr("created_at DESC").Scan(ctx); err != nil {
		return nil, nil, fmt.Errorf("failed to list registries: %w", err)
	}

	for _, registry := range registries {
		host := normalizeRegistryHost(registry.URL)
		if !strings.HasPrefix(imageName, host+"/") && host != "docker.io" {
			continue
		}

		envVars, err := buildRegistryEnv(&registry)
		if err != nil {
			log.Warnf("ResolveRegistryForScan: skipping registry %s: %v", registry.Name, err)
			continue
		}

		return &registry, envVars, nil
	}

	return nil, nil, nil
}

func buildRegistryEnv(registry *models.Registry) ([]string, error) {
	switch registry.AuthType {
	case "", models.RegistryAuthNone:
		return nil, nil
	}

	password := ""
	if registry.Password != "" {
		encKey := crypto.KeyFromString(config.Config.Encryption.Key)
		decryptedPassword, err := crypto.Decrypt(encKey, registry.Password)
		if err != nil {
			return nil, fmt.Errorf("failed to decrypt credentials for registry %s: %w", registry.Name, err)
		}
		password = decryptedPassword
	}

	switch registry.AuthType {
	case models.RegistryAuthBasic:
		return []string{
			"TRIVY_USERNAME=" + registry.Username,
			"TRIVY_PASSWORD=" + password,
		}, nil
	case models.RegistryAuthToken:
		return []string{
			"TRIVY_REGISTRY_TOKEN=" + password,
		}, nil
	case models.RegistryAuthAWSECR:
		return []string{
			"AWS_ACCESS_KEY_ID=" + registry.Username,
			"AWS_SECRET_ACCESS_KEY=" + password,
		}, nil
	default:
		return nil, fmt.Errorf("unsupported registry auth type %q", registry.AuthType)
	}
}

func normalizeRegistryHost(url string) string {
	host := strings.TrimPrefix(url, "https://")
	host = strings.TrimPrefix(host, "http://")
	host = strings.TrimSuffix(host, "/")
	return host
}
