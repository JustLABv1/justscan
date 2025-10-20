package migrations

import (
	"context"
	"fmt"

	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		return addCsvBridgeReachableColumn(ctx, db)
	}, func(ctx context.Context, db *bun.DB) error {
		return removeReachableFromCSVBridges(ctx, db)
	})
}

func addCsvBridgeReachableColumn(ctx context.Context, db *bun.DB) error {
	// add reachable column
	exists, err := columnExists(ctx, db, "csv_bridges", "reachable")
	if err != nil {
		return fmt.Errorf("failed to check if reachable column exists: %v", err)
	}
	if !exists {
		_, err := db.NewAddColumn().
			Table("csv_bridges").
			ColumnExpr("reachable BOOL DEFAULT false").
			Exec(ctx)

		if err != nil {
			return fmt.Errorf("failed to add reachable column to csv_bridges table: %v", err)
		}
	} else {
		log.Debug("reachable column already exists in csv_bridges table")
	}

	return nil
}

func removeReachableFromCSVBridges(ctx context.Context, db *bun.DB) error {
	exists, err := columnExists(ctx, db, "csv_bridges", "reachable")
	if err != nil {
		return fmt.Errorf("failed to check if reachable column exists: %v", err)
	}
	if exists {
		_, err := db.NewDropColumn().
			Table("csv_bridges").
			Column("reachable").
			Exec(ctx)

		if err != nil {
			return fmt.Errorf("failed to remove reachable column from csv_bridges table: %v", err)
		}
	} else {
		log.Debug("reachable column already removed from csv_bridges table")
	}

	return nil
}
