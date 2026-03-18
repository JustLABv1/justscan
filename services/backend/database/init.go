package database

import (
	"context"
	"database/sql"
	"runtime"
	"strconv"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
	"github.com/uptrace/bun/extra/bunotel"
	"github.com/uptrace/bun/migrate"

	"justscan-backend/database/migrations"
	"justscan-backend/middlewares"
	"justscan-backend/pkg/models"

	log "github.com/sirupsen/logrus"
)

func StartPostgres(dbServer string, dbPort int, dbUser string, dbPass string, dbName string) *bun.DB {
	log.Info("Connecting to PostgreSQL database...")

	pgconn := pgdriver.NewConnector(
		pgdriver.WithAddr(dbServer+":"+strconv.Itoa(dbPort)),
		pgdriver.WithUser(dbUser),
		pgdriver.WithPassword(dbPass),
		pgdriver.WithDatabase(dbName),
		pgdriver.WithApplicationName("exflow"),
		pgdriver.WithTLSConfig(nil),
	)

	sqldb := sql.OpenDB(pgconn)
	db := bun.NewDB(sqldb, pgdialect.New(), bun.WithDiscardUnknownColumns())
	db.AddQueryHook(bunotel.NewQueryHook(bunotel.WithDBName(dbName)))

	// Register m2m join models so bun can resolve their relations
	db.RegisterModel((*models.ScanTag)(nil))
	db.RegisterModel((*models.OrgScan)(nil))

	maxOpenConns := 4 * runtime.GOMAXPROCS(0)
	db.SetMaxOpenConns(maxOpenConns)
	db.SetMaxIdleConns(maxOpenConns)
	// Recycle connections before NAT/firewall silently drops idle TCP connections.
	db.SetConnMaxLifetime(30 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)

	// Create a new migrator
	migrator := migrate.NewMigrator(db, migrations.Migrations)

	// Run migrations
	ctx := context.Background()
	if err := migrator.Init(ctx); err != nil {
		log.Fatal(err)
	}

	// Clear any stale lock left by a previously crashed instance.
	_ = migrator.Unlock(ctx)

	if err := migrator.Lock(ctx); err != nil {
		log.Fatal(err)
	}

	group, err := migrator.Migrate(ctx)
	if unlockErr := migrator.Unlock(ctx); unlockErr != nil {
		log.Errorf("Failed to release migration lock: %v", unlockErr)
	}
	if err != nil {
		log.Fatal(err)
	}

	log.Info("Database connected successfully")

	if group.ID == 0 {
		log.Info("No migrations to run.")
	} else {
		log.Infof("Migrated to %s\n", group)
	}

	// Load persisted rate limit setting
	var rateLimitSetting models.SystemSetting
	if err := db.NewSelect().Model(&rateLimitSetting).Where("key = ?", "public_scan_rate_limit").Scan(ctx); err == nil {
		if v, err := strconv.Atoi(rateLimitSetting.Value); err == nil && v > 0 {
			middlewares.SetPublicScanRateLimit(v)
			log.Infof("Rate limit loaded from DB: %d/hour", v)
		}
	}

	return db
}

func StartDatabase(dbDriver string, dbServer string, dbPort int, dbUser, dbPass, dbName string) *bun.DB {
	log.Info("Starting database connection...")
	switch dbDriver {
	case "postgres":
		return StartPostgres(dbServer, dbPort, dbUser, dbPass, dbName)
	default:
		log.Fatalf("Unsupported database type: %s", dbDriver)
		return nil
	}
}
