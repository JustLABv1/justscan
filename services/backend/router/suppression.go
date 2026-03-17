package router

import (
	"justscan-backend/handlers/suppressions"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Suppressions(router *gin.RouterGroup, db *bun.DB) {
	s := router.Group("/images/:digest/suppressions").Use(middlewares.Auth(db))
	{
		s.GET("/", suppressions.ListSuppressions(db))
		s.POST("/", suppressions.UpsertSuppression(db))
		s.DELETE("/:vulnId", suppressions.DeleteSuppression(db))
	}
}
