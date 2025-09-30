package router

import (
	"justwms-backend/middlewares"

	"justwms-backend/handlers/geraete"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Geraete(router *gin.RouterGroup, db *bun.DB) {
	geraet := router.Group("/geraete")
	{
		geraet.Use(middlewares.Auth(db)).GET("/", func(c *gin.Context) {
			geraete.GetGeraete(c, db)
		})
		geraet.Use(middlewares.Admin(db)).POST("/", func(c *gin.Context) {
			geraete.UploadGeraete(c, db)
		})
		geraet.Use(middlewares.Admin(db)).POST("/check", func(c *gin.Context) {
			geraete.CheckUploadedGeraete(c, db)
		})
	}
}
