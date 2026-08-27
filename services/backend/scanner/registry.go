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
func ResolveRegistryForScan(ctx context.Context, db bun.IDB, imageName string, registryID *uuid.UUID) (*models.Registry, []string, error) {
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
		if !RegistryMatchesImage(imageName, &registry) {
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

	password, err := decryptRegistrySecret(registry)
	if err != nil {
		return nil, err
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

func decryptRegistrySecret(registry *models.Registry) (string, error) {
	if registry == nil || registry.Password == "" {
		return "", nil
	}

	encKey := crypto.KeyFromString(config.Config.Encryption.Key)
	decryptedPassword, err := crypto.Decrypt(encKey, registry.Password)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt credentials for registry %s: %w", registry.Name, err)
	}

	return decryptedPassword, nil
}

func normalizeRegistryHost(url string) string {
	host := strings.TrimPrefix(url, "https://")
	host = strings.TrimPrefix(host, "http://")
	host = strings.TrimSuffix(host, "/")
	return host
}

// RegistryMatchesImage reports whether an image reference is addressed to a
// registry endpoint. Unqualified names are treated as Docker Hub images, as
// they are by Docker and by ResolveRegistryForScan. Keeping this predicate
// separate lets repository discovery identify a configured registry without
// decrypting its credentials first.
func RegistryMatchesImage(imageName string, registry *models.Registry) bool {
	if registry == nil {
		return false
	}
	host := normalizeRegistryHost(registry.URL)
	if host == "" {
		return false
	}
	trimmedName := strings.Trim(strings.TrimSpace(imageName), "/")
	if trimmedName == "" {
		return false
	}
	return strings.HasPrefix(trimmedName, host+"/") || (host == "docker.io" && !hasRegistryHost(trimmedName))
}

// NormalizeScanTarget trims user input, removes accidental leading/trailing
// separators, and qualifies unqualified image names when a registry is chosen.
func NormalizeScanTarget(imageName, imageTag string, registry *models.Registry) (string, string) {
	return NormalizeScanTargetWithXrayRepository(imageName, imageTag, registry, "")
}

// NormalizeScanTargetWithXrayRepository applies the same normalization as
// NormalizeScanTarget plus an optional Xray repository override used for
// Artifactory-backed scans.
func NormalizeScanTargetWithXrayRepository(imageName, imageTag string, registry *models.Registry, xrayRepository string) (string, string) {
	trimmedName := strings.TrimSpace(imageName)
	trimmedName = strings.TrimSuffix(trimmedName, ":")
	trimmedTag := strings.TrimSpace(imageTag)
	trimmedTag = strings.TrimPrefix(trimmedTag, ":")

	if registry != nil {
		trimmedName = QualifyImageNameForRegistryWithXrayRepository(trimmedName, registry, xrayRepository)
	}

	return trimmedName, trimmedTag
}

// QualifyImageNameForRegistry prefixes an image with the selected registry host
// when the image name is not already fully qualified.
func QualifyImageNameForRegistry(imageName string, registry *models.Registry) string {
	return QualifyImageNameForRegistryWithXrayRepository(imageName, registry, "")
}

func QualifyImageNameForRegistryWithXrayRepository(imageName string, registry *models.Registry, xrayRepository string) string {
	trimmedName := strings.TrimSpace(imageName)
	if trimmedName == "" || registry == nil {
		return trimmedName
	}

	host := normalizeRegistryHost(registry.URL)
	remainder := strings.TrimPrefix(strings.Trim(trimmedName, "/"), "/")
	if hasRegistryHost(trimmedName) {
		if host == "" || !strings.HasPrefix(trimmedName, host+"/") {
			return trimmedName
		}
		// A fully qualified image on the selected Artifactory host already
		// carries its repository key as the first path segment. Preserve that
		// explicit routing instead of forcing the registry's default Xray repo.
		return trimmedName
	}

	remainder = qualifyXrayRepositoryPath(remainder, effectiveXrayRepository(registry, xrayRepository))
	return host + "/" + remainder
}

func effectiveXrayRepository(registry *models.Registry, xrayRepository string) string {
	if registry == nil || registry.ScanProvider != models.ScanProviderArtifactoryXray {
		return ""
	}
	if trimmed := strings.Trim(strings.TrimSpace(xrayRepository), "/"); trimmed != "" {
		return trimmed
	}
	return strings.Trim(strings.TrimSpace(registry.XrayRepository), "/")
}

func qualifyXrayRepositoryPath(imagePath, xrayRepository string) string {
	trimmedPath := strings.Trim(strings.TrimSpace(imagePath), "/")
	if trimmedPath == "" {
		return trimmedPath
	}
	trimmedRepo := strings.Trim(strings.TrimSpace(xrayRepository), "/")
	if trimmedRepo == "" || trimmedPath == trimmedRepo || strings.HasPrefix(trimmedPath, trimmedRepo+"/") {
		return trimmedPath
	}
	return trimmedRepo + "/" + trimmedPath
}

func hasRegistryHost(imageName string) bool {
	firstSegment := imageName
	if slash := strings.Index(firstSegment, "/"); slash != -1 {
		firstSegment = firstSegment[:slash]
	}
	return firstSegment == "localhost" || strings.Contains(firstSegment, ".") || strings.Contains(firstSegment, ":")
}
