package router

import (
	"justwms-backend/middlewares"

	"justwms-backend/handlers/artikel"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Artikel(router *gin.RouterGroup, db *bun.DB) {
	artike := router.Group("/artikel")
	{
		artike.Use(middlewares.Auth(db)).GET("/", func(c *gin.Context) {
			artikel.GetArtikel(c, db)
		})
		artike.Use(middlewares.Admin(db)).POST("/", func(c *gin.Context) {
			artikel.UploadArtikel(c, db)
		})
		artike.Use(middlewares.Admin(db)).POST("/check", func(c *gin.Context) {
			artikel.CheckUploadedArtikel(c, db)
		})
	}
}
