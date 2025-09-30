package router

import (
	"github.com/JustNZ/JustWMS/services/backend/middlewares"

	"github.com/JustNZ/JustWMS/services/backend/handlers/geraete"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Geraete(router *gin.RouterGroup, db *bun.DB) {
	geraet := router.Group("/geraete").Use(middlewares.Auth(db))
	{
		geraet.GET("/", func(c *gin.Context) {
			geraete.GetGeraete(c, db)
		})
		geraet.POST("/", func(c *gin.Context) {
			geraete.UploadGeraete(c, db)
		})
		geraet.POST("/check", func(c *gin.Context) {
			geraete.CheckUploadedGeraete(c, db)
		})
	}
}
