package router

import (
	"justscan-backend/handlers/registries"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Registries(router *gin.RouterGroup, db *bun.DB) {
	r := router.Group("/registries").Use(middlewares.Auth(db))
	{
		r.GET("/", registries.ListRegistries(db))
		r.POST("/", registries.CreateRegistry(db))
		r.PUT("/:id", registries.UpdateRegistry(db))
		r.DELETE("/:id", registries.DeleteRegistry(db))
		r.GET("/:id/shares", registries.ListRegistryShares(db))
		r.POST("/:id/shares", registries.ShareRegistry(db))
		r.DELETE("/:id/shares/:orgId", registries.UnshareRegistry(db))
		r.POST("/:id/test", registries.TestRegistry(db))
	}
}
