package router

import (
	helm "justscan-backend/handlers/helm"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Helm(router *gin.RouterGroup, db *bun.DB) {
	h := router.Group("/helm").Use(middlewares.Auth(db))
	{
		h.POST("/extract", helm.ExtractImages(db))
		h.POST("/scan", helm.CreateScans(db))
		h.GET("/runs", helm.ListRuns(db))
		h.GET("/runs/:id", helm.GetRun(db))
	}
}
