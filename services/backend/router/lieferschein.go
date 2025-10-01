package router

import (
	"justwms-backend/handlers/lieferschein"
	"justwms-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Lieferschein(router *gin.RouterGroup, db *bun.DB) {
	liefer := router.Group("/lieferschein")
	{
		liefer.Use(middlewares.Auth(db)).POST("/", func(c *gin.Context) {
			lieferschein.CreateLieferschein(c, db)
		})
	}
}
