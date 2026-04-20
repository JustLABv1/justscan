package router

import (
	"justscan-backend/handlers/suppressions"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Suppressions(router *gin.RouterGroup, db *bun.DB) {
	// Global list
	global := router.Group("/suppressions").Use(middlewares.Auth(db))
	global.GET("/", suppressions.ListAllSuppressions(db))
	global.DELETE("/:id", suppressions.DeleteSuppressionByID(db))
	global.GET("/:id/shares", suppressions.ListSuppressionShares(db))
	global.POST("/:id/shares", suppressions.ShareSuppression(db))
	global.DELETE("/:id/shares/:orgId", suppressions.UnshareSuppression(db))

	// Per-image CRUD
	s := router.Group("/images/:digest/suppressions").Use(middlewares.Auth(db))
	{
		s.GET("", suppressions.ListSuppressions(db))
		s.POST("", suppressions.UpsertSuppression(db))
		s.DELETE("/:vulnId", suppressions.DeleteSuppression(db))
	}
}
