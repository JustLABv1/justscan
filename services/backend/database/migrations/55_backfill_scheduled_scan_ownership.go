package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		statements := []string{
			`UPDATE scans AS scan
			 SET owner_type = CASE
			 		WHEN watchlist.owner_org_id IS NOT NULL THEN 'org'
			 		ELSE 'user'
			 	END,
			 	 owner_user_id = CASE
			 		WHEN watchlist.owner_org_id IS NOT NULL THEN NULL
			 		ELSE COALESCE(watchlist.owner_user_id, watchlist.user_id)
			 	 END,
			 	 owner_org_id = watchlist.owner_org_id
			 FROM watchlist_items AS watchlist
			 WHERE watchlist.last_scan_id = scan.id
			 	AND scan.owner_user_id IS NULL
			 	AND scan.owner_org_id IS NULL`,
			`INSERT INTO org_scans (org_id, scan_id)
			 SELECT watchlist.owner_org_id, watchlist.last_scan_id
			 FROM watchlist_items AS watchlist
			 JOIN scans AS scan ON scan.id = watchlist.last_scan_id
			 WHERE watchlist.owner_org_id IS NOT NULL
			 ON CONFLICT DO NOTHING`,
			`UPDATE scans
			 SET owner_type = 'user', owner_user_id = user_id
			 WHERE user_id IS NOT NULL
			 	AND owner_user_id IS NULL
			 	AND owner_org_id IS NULL`,
		}

		for _, statement := range statements {
			if _, err := db.NewRaw(statement).Exec(ctx); err != nil {
				return fmt.Errorf("migration 55: %w", err)
			}
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		return nil
	})
}
