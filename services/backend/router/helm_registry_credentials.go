package router

import (
	"justscan-backend/handlers/helmregistrycredentials"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func HelmRegistryCredentials(router *gin.RouterGroup, db *bun.DB) {
	r := router.Group("/helm-registry-credentials").Use(middlewares.Auth(db))
	{
		r.GET("/", helmregistrycredentials.List(db))
		r.POST("/", helmregistrycredentials.Create(db))
		r.PUT("/:id", helmregistrycredentials.Update(db))
		r.DELETE("/:id", helmregistrycredentials.Delete(db))
		r.POST("/:id/test", helmregistrycredentials.Test(db))
		r.GET("/:id/shares", helmregistrycredentials.ListShares(db))
		r.POST("/:id/shares", helmregistrycredentials.Share(db))
		r.DELETE("/:id/shares/:orgId", helmregistrycredentials.Unshare(db))
		r.POST("/:id/transfer-ownership", helmregistrycredentials.Transfer(db))
	}
}
