package main

import (
	"context"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata"

	"justscan-backend/config"
	"justscan-backend/database"
	"justscan-backend/functions/auth"
	"justscan-backend/handlers/registries"
	"justscan-backend/router"
	"justscan-backend/scanner"
	"justscan-backend/scheduler"

	"github.com/alecthomas/kingpin/v2"
	log "github.com/sirupsen/logrus"
)

const version string = "1.6.2"

var (
	configFile = kingpin.Flag("config", "Config file").Short('c').Default("/etc/justscan/config.yaml").String()
)

func logging(logLevel string) {
	logLevel = strings.ToLower(logLevel)

	switch logLevel {
	case "info":
		log.SetLevel(log.InfoLevel)
	case "warn":
		log.SetLevel(log.WarnLevel)
	case "error":
		log.SetLevel(log.ErrorLevel)
	case "debug":
		log.SetLevel(log.DebugLevel)
	default:
		log.SetLevel(log.InfoLevel)
	}
}

func main() {
	kingpin.Version(version)
	kingpin.HelpFlag.Short('h')
	kingpin.Parse()

	log.Info("Starting JustScan API. Version: ", version)

	// Check if config file exists
	if _, err := os.Stat(*configFile); os.IsNotExist(err) {
		log.Fatal("Config file not found.")
		return
	}

	log.Info("Loading Config File: ", *configFile)
	err := config.GetInstance().LoadConfig(*configFile)
	if err != nil {
		log.Fatal("Failed to load config file", err)
		return
	}

	cfg := config.Config
	log.Info("Config loaded successfully")

	logging(cfg.LogLevel)

	// Initialise OIDC provider if enabled.
	if cfg.OIDC.Enabled {
		if err := auth.InitOIDCProvider(context.Background()); err != nil {
			log.Fatal("Failed to initialise OIDC provider: ", err)
		}
		log.Info("OIDC provider initialised: ", cfg.OIDC.IssuerURL)
	}

	db := database.StartDatabase(cfg.Database.Driver, cfg.Database.Server, cfg.Database.Port, cfg.Database.User, cfg.Database.Password, cfg.Database.Name)
	if db == nil {
		log.Fatal("Failed to connect to the database")
	}

	// Start async scan worker pool
	scanner.InitWorker(db)

	// Start watchlist scheduler
	scheduler.Start(db)
	registries.StartHealthChecks(db)

	// Set up signal handling for graceful shutdown
	server := router.StartRouter(db, cfg.Port, cfg)

	// Wait for interrupt signal to gracefully shutdown the server
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Info("Shutting down server...")

	scheduler.Stop()
	registries.StopHealthChecks()

	// The server has 30 seconds to finish the request it is currently handling
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Info("Server exited")
}
