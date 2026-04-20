package audit

import (
	"context"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// Write inserts an audit record. Failures are logged but never fatal.
func Write(ctx context.Context, db *bun.DB, userID, operation, details string) {
	entry := &models.Audit{
		UserID:    userID,
		Operation: operation,
		Details:   details,
	}
	if _, err := db.NewInsert().Model(entry).Exec(ctx); err != nil {
		log.Warnf("audit.Write: failed to persist audit log: %v", err)
	}
}

// WriteOrgAction inserts an audit record scoped to an organization.
func WriteOrgAction(ctx context.Context, db *bun.DB, userID string, orgID uuid.UUID, operation, details string) {
	entry := &models.Audit{
		UserID:    userID,
		OrgID:     &orgID,
		Operation: operation,
		Details:   details,
	}
	if _, err := db.NewInsert().Model(entry).Exec(ctx); err != nil {
		log.Warnf("audit.WriteOrgAction: failed to persist audit log: %v", err)
	}
}
