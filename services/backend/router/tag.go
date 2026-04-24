package router

import (
	"justscan-backend/handlers/tags"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Tags(router *gin.RouterGroup, db *bun.DB) {
	t := router.Group("/tags").Use(middlewares.Auth(db))
	{
		t.GET("/", tags.ListTags(db))
		t.POST("/", tags.CreateTag(db))
		t.PUT("/:id", tags.UpdateTag(db))
		t.DELETE("/:id", tags.DeleteTag(db))
		t.GET("/:id/shares", tags.ListTagShares(db))
		t.POST("/:id/shares", tags.ShareTag(db))
		t.DELETE("/:id/shares/:orgId", tags.UnshareTag(db))
	}
}
