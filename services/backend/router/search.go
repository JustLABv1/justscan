package router

import (
	"justscan-backend/handlers/search"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Search(router *gin.RouterGroup, db *bun.DB) {
	s := router.Group("/search").Use(middlewares.Auth(db))
	{
		s.GET("/", search.Search(db))
	}
}
