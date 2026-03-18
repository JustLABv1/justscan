package router

import (
	"justscan-backend/handlers/autotags"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func AutoTags(router *gin.RouterGroup, db *bun.DB) {
	a := router.Group("/auto-tags").Use(middlewares.Auth(db))
	{
		a.GET("/", autotags.List(db))
		a.POST("/", autotags.Create(db))
		a.PUT("/:id", autotags.Update(db))
		a.DELETE("/:id", autotags.Delete(db))
	}
}
