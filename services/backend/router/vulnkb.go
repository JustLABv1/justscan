package router

import (
	"justscan-backend/handlers/vulnkb"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func VulnKB(router *gin.RouterGroup, db *bun.DB) {
	kb := router.Group("/kb").Use(middlewares.Auth(db))
	{
		kb.GET("/", vulnkb.ListKBEntries(db))
		kb.GET("/:vulnId", vulnkb.GetKBEntry(db))
	}
}
