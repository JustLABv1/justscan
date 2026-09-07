package scans

import (
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// Rank only visible pending work in the selected workspace and provider lane.
// This is an estimate: recovery, multiple replicas and execution capacity can
// change start order. Never expose other workspaces through queue metadata.
func attachQueuePositions(c *gin.Context, db *bun.DB, scans []*models.Scan, userID uuid.UUID, isAdmin bool, orgIDs []uuid.UUID) error {
	ids := make([]uuid.UUID, 0, len(scans))
	for _, scan := range scans {
		if scan.Status == models.ScanStatusPending {
			ids = append(ids, scan.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	query := db.NewSelect().Model((*models.Scan)(nil)).
		Column("id").
		ColumnExpr("ROW_NUMBER() OVER (PARTITION BY COALESCE(NULLIF(scan_provider, ''), 'trivy') ORDER BY created_at, id) AS position").
		Where("status = ?", models.ScanStatusPending)
	query = authz.ApplyOwnershipVisibility(query, "scan", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, orgIDs)
	query = authz.ApplyWorkspaceScope(c, query, "scan", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID)
	var positions []struct {
		ID       uuid.UUID
		Position int
	}
	if err := db.NewSelect().TableExpr("(?) AS ranked", query).Where("id IN (?)", bun.In(ids)).Scan(c.Request.Context(), &positions); err != nil {
		return err
	}
	byID := make(map[uuid.UUID]int, len(positions))
	for _, position := range positions {
		byID[position.ID] = position.Position
	}
	for _, scan := range scans {
		if position, ok := byID[scan.ID]; ok {
			scan.QueuePosition = &position
		}
	}
	return nil
}
