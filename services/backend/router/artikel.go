package router

import (
	"justwms/middlewares"

	"justwms/handlers/artikel"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Artikel(router *gin.RouterGroup, db *bun.DB) {
	artike := router.Group("/artikel").Use(middlewares.Auth(db))
	{
		artike.GET("/", func(c *gin.Context) {
			artikel.GetArtikel(c, db)
		})
		artike.POST("/", func(c *gin.Context) {
			artikel.UploadArtikel(c, db)
		})
		artike.POST("/check", func(c *gin.Context) {
			artikel.CheckUploadedArtikel(c, db)
		})
	}
}
