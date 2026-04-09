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
		s.POST("/:token/rescan", shared.RescanShared(db))
	}
}
