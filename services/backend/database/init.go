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

	"justscan-backend/config"
	"justscan-backend/database/migrations"
	authfuncs "justscan-backend/functions/auth"
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
	db.RegisterModel((*models.StatusPageTarget)(nil))

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

	var registerRateLimitSetting models.SystemSetting
	if err := db.NewSelect().Model(&registerRateLimitSetting).Where("key = ?", "register_rate_limit").Scan(ctx); err == nil {
		if v, err := strconv.Atoi(registerRateLimitSetting.Value); err == nil && v > 0 {
			middlewares.SetAuthRegisterRateLimit(v)
			log.Infof("Registration rate limit loaded from DB: %d/hour", v)
		}
	}

	// Initialise the setting resolver (DB-backed runtime settings).
	config.InitSettingResolver(db)

	// Initialise the multi-provider OIDC runtime cache.
	authfuncs.InitMultiOIDC(db)

	// Seed legacy single-provider OIDC config into oidc_providers table if needed.
	seedOIDCProvider(ctx, db)

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

// seedOIDCProvider migrates a legacy single-provider OIDC config block into the
// oidc_providers table on first startup. It does nothing if rows already exist.
func seedOIDCProvider(ctx context.Context, db *bun.DB) {
	cfg := config.Config
	if !cfg.OIDC.Enabled || cfg.OIDC.IssuerURL == "" {
		return
	}
	exists, err := db.NewSelect().TableExpr("oidc_providers").Exists(ctx)
	if err != nil || exists {
		return
	}

	scopes := cfg.OIDC.Scopes
	if len(scopes) == 0 {
		scopes = []string{"openid", "email", "profile"}
	}
	groupsClaim := cfg.OIDC.GroupsClaim
	if groupsClaim == "" {
		groupsClaim = "groups"
	}
	rolesClaim := cfg.OIDC.RolesClaim
	if rolesClaim == "" {
		rolesClaim = "roles"
	}

	provider := &models.OIDCProvider{
		Name:         "default",
		DisplayName:  "Login with SSO",
		ButtonColor:  "",
		IssuerURL:    cfg.OIDC.IssuerURL,
		ClientID:     cfg.OIDC.ClientID,
		ClientSecret: cfg.OIDC.ClientSecret,
		RedirectURI:  cfg.OIDC.RedirectURI,
		Scopes:       scopes,
		AdminGroups:  cfg.OIDC.AdminGroups,
		AdminRoles:   cfg.OIDC.AdminRoles,
		GroupsClaim:  groupsClaim,
		RolesClaim:   rolesClaim,
		Enabled:      true,
		SortOrder:    0,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	if _, err := db.NewInsert().Model(provider).On("CONFLICT (name) DO NOTHING").Exec(ctx); err != nil {
		log.Warnf("Failed to seed legacy OIDC provider into DB: %v", err)
		return
	}
	log.Info("Seeded legacy OIDC config into oidc_providers table as 'default'")
}
