package main

import (
	"flag"
	"fmt"
	"net/http"
	"time"

	"csv-bridge/config"
	"csv-bridge/handlers"
	"csv-bridge/vps"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

func main() {
	// Parse command line flags
	var configPath = flag.String("config", "config.yaml", "Path to configuration file")
	var showVersion = flag.Bool("version", false, "Show version information")
	flag.Parse()

	if *showVersion {
		fmt.Println("CSV Bridge Service v1.0.0")
		return
	}

	// Load configuration
	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	log.Infof("Starting CSV Bridge Service %s (ID: %s)", cfg.Bridge.ServiceName, cfg.Bridge.ServiceID)
	log.Infof("Upload directory: %s", cfg.Server.UploadDir)
	log.Infof("VPS URL: %s", cfg.VPS.BaseURL)

	// Set up Gin router
	if cfg.Logging.Level != "debug" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.Default()

	// CORS middleware
	if cfg.Security.EnableCORS {
		router.Use(func(c *gin.Context) {
			origin := c.Request.Header.Get("Origin")

			// Check if origin is allowed
			allowed := false
			for _, allowedOrigin := range cfg.Server.AllowedOrigins {
				if allowedOrigin == "*" || allowedOrigin == origin {
					allowed = true
					break
				}
			}

			if allowed {
				c.Header("Access-Control-Allow-Origin", origin)
			}
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")
			c.Header("Access-Control-Allow-Credentials", "true")

			if c.Request.Method == "OPTIONS" {
				c.AbortWithStatus(http.StatusNoContent)
				return
			}

			c.Next()
		})
	}

	// Set trusted proxies if configured
	if len(cfg.Security.TrustedProxies) > 0 {
		router.SetTrustedProxies(cfg.Security.TrustedProxies)
	}

	// Routes
	router.GET("/health", handlers.HealthCheck(cfg))
	router.GET("/info", handlers.GetServiceInfo(cfg))
	router.GET("/heartbeat", handlers.GetHeartbeatStatus(cfg))
	router.POST("/upload", handlers.UploadCSV(cfg))

	// Test and register with VPS application
	log.Info("Testing VPS connectivity and registration...")
	if err := vps.TestHeartbeat(cfg); err != nil {
		log.Errorf("Failed to register with VPS: %v", err)
		log.Warn("Service will continue to run, but may not be reachable from VPS")
		log.Info("Check your VPS URL, API token, and network connectivity")
	} else {
		log.Info("Successfully registered with VPS")
	}

	// Start heartbeat goroutine
	log.Info("Starting heartbeat service...")
	vps.StartHeartbeat(cfg)

	// Alternative: Use simple heartbeat if the ticker-based one doesn't work
	// Uncomment the line below and comment out the line above to use simple heartbeat
	// vps.StartSimpleHeartbeat(cfg)

	// Start HTTP server
	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	log.Infof("Starting server on %s", addr)

	server := &http.Server{
		Addr:           addr,
		Handler:        router,
		ReadTimeout:    30 * time.Second,
		WriteTimeout:   30 * time.Second,
		MaxHeaderBytes: 1 << 20, // 1MB
	}

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Failed to start server: %v", err)
	}
}
