package router

import (
	"justscan-backend/handlers/comments"
	"justscan-backend/handlers/orgs"
	"justscan-backend/handlers/scans"
	"justscan-backend/handlers/tags"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Scans(router *gin.RouterGroup, db *bun.DB) {
	s := router.Group("/scans").Use(middlewares.Auth(db))
	{
		s.GET("/", scans.ListScans(db))
		s.POST("/", scans.CreateScan(db))
		s.GET("/compare", scans.Compare(db))
		s.GET("/trends", scans.GetTrends(db))
		s.GET("/:id", scans.GetScan(db))
		s.DELETE("/:id", scans.DeleteScan(db))
		s.GET("/:id/vulnerabilities", scans.ListVulnerabilities(db))
		s.GET("/:id/sbom", scans.GetSBOM(db))
		s.GET("/:id/export", scans.ExportScan(db))
		s.POST("/:id/tags/:tagId", tags.AddTagToScan(db))
		s.DELETE("/:id/tags/:tagId", tags.RemoveTagFromScan(db))
		s.POST("/:id/vulnerabilities/:vulnId/comments", comments.CreateComment(db))
		s.GET("/:id/compliance", orgs.GetScanCompliance(db))
		s.POST("/:id/compliance/evaluate", orgs.ReEvaluate(db))
	}
}
