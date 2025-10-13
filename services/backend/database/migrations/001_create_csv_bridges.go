package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		_, err := db.ExecContext(ctx, `
			CREATE TABLE IF NOT EXISTS csv_bridges (
				id VARCHAR(36) PRIMARY KEY,
				service_id VARCHAR(255) NOT NULL UNIQUE,
				service_name VARCHAR(255) NOT NULL,
				version VARCHAR(50),
				upload_url TEXT NOT NULL,
				health_url TEXT NOT NULL,
				api_key VARCHAR(255) NOT NULL,
				max_file_size BIGINT DEFAULT 10485760,
				is_active BOOLEAN NOT NULL DEFAULT true,
				last_heartbeat TIMESTAMP,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`)
		return err
	}, func(ctx context.Context, db *bun.DB) error {
		_, err := db.ExecContext(ctx, "DROP TABLE IF EXISTS csv_bridges")
		return err
	})
}
