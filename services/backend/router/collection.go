package router

import (
	"justscan-backend/handlers/collections"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Collections(router *gin.RouterGroup, db *bun.DB) {
	collectionGroup := router.Group("/collections").Use(middlewares.Auth(db))
	{
		collectionGroup.GET("/", collections.ListCollections(db))
		collectionGroup.POST("/", collections.CreateCollection(db))
		collectionGroup.PUT("/:id", collections.UpdateCollection(db))
		collectionGroup.DELETE("/:id", collections.DeleteCollection(db))
	}
}
