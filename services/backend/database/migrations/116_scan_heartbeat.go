package migrations

import (
	"context"
	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewRaw(`ALTER TABLE scans ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz`).Exec(ctx)
		return err
	}, func(ctx context.Context, db *bun.DB) error {
		_, err := db.NewRaw(`ALTER TABLE scans DROP COLUMN IF EXISTS last_heartbeat_at`).Exec(ctx)
		return err
	})
}
