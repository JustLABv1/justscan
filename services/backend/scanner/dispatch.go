package scanner

import (
	"context"
	"fmt"
	"time"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
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
		scan.ExternalStatus = "fallback_trivy"
		if scan.ID != uuid.Nil {
			if _, err := db.NewUpdate().Model((*models.Scan)(nil)).
				Set("external_status = ?", scan.ExternalStatus).
				Where("id = ?", scan.ID).
				Exec(context.Background()); err != nil {
				return fmt.Errorf("failed to persist fallback status for scan %s: %w", scan.ID, err)
			}
		}

		log.Warnf("DispatchScan: provider %q selected for scan %s, falling back to Trivy until the Xray adapter is implemented", provider, scan.ID)
		EnqueueScan(scan.ID, db, envVars, platform)
		return nil
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
