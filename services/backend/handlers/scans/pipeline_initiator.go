package scans

import (
	"context"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func loadPipelineInitiators(ctx context.Context, db bun.IDB, scanIDs []uuid.UUID) (map[uuid.UUID]*models.PipelineInitiator, error) {
	initiators := make(map[uuid.UUID]*models.PipelineInitiator)
	if len(scanIDs) == 0 {
		return initiators, nil
	}

	type row struct {
		ScanID                    uuid.UUID  `bun:"scan_id"`
		Source                    string     `bun:"source"`
		InitiatorTokenID          *uuid.UUID `bun:"initiator_token_id"`
		InitiatorTokenDescription string     `bun:"initiator_token_description"`
	}
	var rows []row
	if err := db.NewSelect().
		TableExpr("pipeline_scan_requests").
		Column("scan_id", "source", "initiator_token_id", "initiator_token_description").
		Where("scan_id IN (?)", bun.In(scanIDs)).
		Scan(ctx, &rows); err != nil {
		return nil, err
	}
	for _, item := range rows {
		initiators[item.ScanID] = &models.PipelineInitiator{
			Source:           item.Source,
			TokenID:          item.InitiatorTokenID,
			TokenDescription: item.InitiatorTokenDescription,
		}
	}
	return initiators, nil
}

func attachPipelineInitiators(ctx context.Context, db bun.IDB, scans []models.Scan) error {
	scanIDs := make([]uuid.UUID, 0, len(scans))
	for _, scan := range scans {
		scanIDs = append(scanIDs, scan.ID)
	}
	initiators, err := loadPipelineInitiators(ctx, db, scanIDs)
	if err != nil {
		return err
	}
	for index := range scans {
		scans[index].PipelineInitiator = initiators[scans[index].ID]
	}
	return nil
}

func attachPipelineInitiator(ctx context.Context, db bun.IDB, scan *models.Scan) error {
	initiators, err := loadPipelineInitiators(ctx, db, []uuid.UUID{scan.ID})
	if err != nil {
		return err
	}
	scan.PipelineInitiator = initiators[scan.ID]
	return nil
}
