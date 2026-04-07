package scanner

import (
	"context"
	"fmt"
	"time"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ProviderForRegistry(registry *models.Registry) string {
	if registry != nil && registry.ScanProvider != "" {
		return registry.ScanProvider
	}
	return models.ScanProviderTrivy
}

// DispatchScan routes a scan to the appropriate provider. Trivy-backed scans
// continue using the existing queue; external providers can plug in here later.
func DispatchScan(_ context.Context, db *bun.DB, scan *models.Scan, envVars []string, platform string) error {
	provider := scan.ScanProvider
	if provider == "" {
		provider = models.ScanProviderTrivy
		scan.ScanProvider = provider
	}

	switch provider {
	case models.ScanProviderTrivy:
		EnqueueScan(scan.ID, db, envVars, platform)
		return nil
	case models.ScanProviderArtifactoryXray:
		return fmt.Errorf("scan provider %q is not implemented yet", provider)
	default:
		return fmt.Errorf("unsupported scan provider %q", provider)
	}
}

// MarkScanFailed stores a failure when dispatch exits before a worker picks the scan up.
func MarkScanFailed(ctx context.Context, db *bun.DB, scanID uuid.UUID, message string) error {
	completedAt := time.Now()
	_, err := db.NewUpdate().Model((*models.Scan)(nil)).
		Set("status = ?", models.ScanStatusFailed).
		Set("error_message = ?", message).
		Set("completed_at = ?", completedAt).
		Where("id = ?", scanID).
		Exec(ctx)
	return err
}
