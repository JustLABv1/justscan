package router

import (
	"justscan-backend/handlers/statuspages"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func StatusPages(router *gin.RouterGroup, db *bun.DB) {
	router.GET("/status-pages/slug/:slug", statuspages.ViewStatusPageBySlug(db))
	router.GET("/status-pages/slug/:slug/scans/:scanId", statuspages.ViewStatusPageScanBySlug(db))
	router.GET("/status-pages/slug/:slug/scans/:scanId/history", statuspages.ViewStatusPageScanHistoryBySlug(db))
	router.GET("/status-pages/slug/:slug/items/:scanId/vulnerabilities", statuspages.ViewStatusPageItemVulnerabilitiesBySlug(db))

	s := router.Group("/status-pages").Use(middlewares.Auth(db))
	{
		s.GET("/", statuspages.ListStatusPages(db))
		s.POST("/", statuspages.CreateStatusPage(db))
		s.GET("/:id", statuspages.GetStatusPage(db))
		s.PUT("/:id", statuspages.UpdateStatusPage(db))
		s.DELETE("/:id", statuspages.DeleteStatusPage(db))
	}
}
