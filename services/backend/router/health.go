package router

import (
	"context"
	"net/http"
	"time"

	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

// Health registers compatibility and Kubernetes-style health endpoints. The
// variadic DB argument preserves the old Health(router) call shape used by
// embedders and tests.
func Health(router *gin.RouterGroup, databases ...*bun.DB) {
	var db *bun.DB
	if len(databases) > 0 {
		db = databases[0]
	}
	livez := func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	}
	router.GET("/health", livez)
	router.GET("/livez", livez)
	router.GET("/readyz", func(c *gin.Context) {
		readyCtx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not_ready", "reason": "database is unavailable"})
			return
		}
		if err := db.PingContext(readyCtx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not_ready", "reason": "database ping failed"})
			return
		}
		// Xray-only deployments intentionally do not require a Trivy binary or
		// local DB. When local scanning is enabled, require at least one worker
		// to have a usable runtime before declaring readiness.
		if scanner.TrivyEnabled() {
			report := scanner.GetHealthReport(readyCtx)
			if report.TotalWorkers > 0 && report.HealthyWorkers == 0 && report.ErrorWorkers == report.TotalWorkers {
				// Keep the unauthenticated probe response deliberately small: the
				// admin scanner-health endpoint owns cache paths and command errors.
				c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not_ready", "reason": "local scanner is unavailable"})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready"})
	})
}
