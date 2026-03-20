package router

import (
	"justscan-backend/handlers/public"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func PublicScan(router *gin.RouterGroup, db *bun.DB) {
	p := router.Group("/public")
	{
		p.GET("/settings", public.GetPublicSettings(db))
		p.POST("/scans", middlewares.PublicScanRateLimit(), public.CreatePublicScan(db))
		p.GET("/scans/:id", public.GetPublicScan(db))
		p.GET("/scans/:id/vulnerabilities", public.ListPublicVulnerabilities(db))
		p.POST("/helm/extract", middlewares.PublicScanRateLimit(), public.ExtractPublicHelmImages(db))
		p.POST("/helm/scan", middlewares.PublicScanRateLimit(), public.CreatePublicHelmScans(db))
	}
}
