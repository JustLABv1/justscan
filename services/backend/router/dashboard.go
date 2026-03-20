package router

import (
	"justscan-backend/handlers/dashboard"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Dashboard(router *gin.RouterGroup, db *bun.DB) {
	d := router.Group("/dashboard").Use(middlewares.Auth(db))
	{
		d.GET("/stats", dashboard.GetStats(db))
		d.GET("/trends", dashboard.GetTrends(db))
		d.GET("/scanner-health", middlewares.Admin(db), dashboard.GetScannerHealth())
	}
}
