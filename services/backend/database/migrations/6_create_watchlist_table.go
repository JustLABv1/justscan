package migrations

import (
	"context"
	"fmt"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		return createWatchlistTable(ctx, db)
	}, func(ctx context.Context, db *bun.DB) error {
		return dropWatchlistTable(ctx, db)
	})
}

func createWatchlistTable(ctx context.Context, db *bun.DB) error {
	_, err := db.NewCreateTable().Model((*models.WatchlistItem)(nil)).IfNotExists().Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to create watchlist_items table: %v", err)
	}

	_, err = db.NewRaw("CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON watchlist_items (user_id)").Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to create index on watchlist_items: %v", err)
	}

	return nil
}

func dropWatchlistTable(ctx context.Context, db *bun.DB) error {
	_, err := db.NewDropTable().Model((*models.WatchlistItem)(nil)).IfExists().Cascade().Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to drop watchlist_items table: %v", err)
	}
	return nil
}
