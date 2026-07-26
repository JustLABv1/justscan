package router

import (
	"justscan-backend/handlers/shared"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func SharedScans(router *gin.RouterGroup, db *bun.DB) {
	s := router.Group("/shared")
	{
		s.GET("/:token", shared.GetSharedScan(db))
		s.GET("/:token/vulnerabilities", shared.ListSharedVulnerabilities(db))
		s.GET("/:token/vulnerabilities/:vulnerabilityId/analysis", shared.GetSharedVulnerabilityContextAnalysis(db))
		s.GET("/:token/sbom", shared.GetSharedSBOM(db))
		s.GET("/:token/sbom/graph", shared.GetSharedSBOMGraph(db))
		s.GET("/:token/sbom/components/:componentId", shared.GetSharedSBOMComponent(db))
		s.GET("/:token/sbom/download", shared.DownloadSharedSBOM(db))
		s.POST("/:token/rescan", shared.RescanShared(db))
	}
}
