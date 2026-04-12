package scanner

import (
	"fmt"
	"strings"

	"justscan-backend/config"
	"justscan-backend/pkg/models"
)

const trivyDisabledMessage = "local Trivy scanning is disabled; select or configure an Artifactory Xray registry"

type ProviderCapability struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Enabled bool   `json:"enabled"`
	Reason  string `json:"reason,omitempty"`
}

type CapabilitySnapshot struct {
	EnableTrivy      bool                 `json:"enable_trivy"`
	EnableGrype      bool                 `json:"enable_grype"`
	LocalScanMessage string               `json:"local_scan_message,omitempty"`
	Providers        []ProviderCapability `json:"providers"`
}

func TrivyEnabled() bool {
	return config.Config != nil && config.Config.Scanner.EnableTrivy
}

func GrypeEnabled() bool {
	return config.Config != nil && config.Config.Scanner.EnableTrivy && config.Config.Scanner.EnableGrype
}

func ScannerCapabilities() CapabilitySnapshot {
	snapshot := CapabilitySnapshot{
		EnableTrivy: TrivyEnabled(),
		EnableGrype: GrypeEnabled(),
		Providers: []ProviderCapability{
			{
				ID:      models.ScanProviderTrivy,
				Label:   "Trivy",
				Enabled: TrivyEnabled(),
			},
			{
				ID:      models.ScanProviderArtifactoryXray,
				Label:   "Artifactory Xray",
				Enabled: true,
			},
		},
	}

	if !snapshot.EnableTrivy {
		snapshot.LocalScanMessage = trivyDisabledMessage
		snapshot.Providers[0].Reason = "Disabled in backend scanner configuration."
	} else if !snapshot.EnableGrype {
		snapshot.Providers[0].Reason = "Grype augmentation is disabled for local scans."
	}

	return snapshot
}

func DefaultScanProvider() (string, error) {
	if TrivyEnabled() {
		return models.ScanProviderTrivy, nil
	}
	return "", fmt.Errorf(trivyDisabledMessage)
}

func NormalizeScanProvider(provider string) string {
	normalized := strings.TrimSpace(provider)
	if normalized == "" {
		return models.ScanProviderTrivy
	}
	return normalized
}

func ValidateProviderSelection(provider string) error {
	switch NormalizeScanProvider(provider) {
	case models.ScanProviderTrivy:
		if !TrivyEnabled() {
			return fmt.Errorf(trivyDisabledMessage)
		}
		return nil
	case models.ScanProviderArtifactoryXray:
		return nil
	default:
		return fmt.Errorf("unsupported scan provider %q", provider)
	}
}

func ProviderForRegistry(registry *models.Registry) (string, error) {
	provider := models.ScanProviderTrivy
	if registry != nil && registry.ScanProvider != "" {
		provider = registry.ScanProvider
	}
	if err := ValidateProviderSelection(provider); err != nil {
		if registry != nil {
			return "", fmt.Errorf("registry %s uses unavailable scan provider %q: %w", registry.Name, provider, err)
		}
		return "", err
	}
	return provider, nil
}

func ValidateRegistryProviderSelection(provider string) error {
	if err := ValidateProviderSelection(provider); err != nil {
		if NormalizeScanProvider(provider) == models.ScanProviderTrivy {
			return fmt.Errorf("Trivy cannot be selected for this registry while local scanning is disabled")
		}
		return err
	}
	return nil
}