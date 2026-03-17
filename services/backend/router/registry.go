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
	}
}
