package router

import (
	"justwms-backend/middlewares"

	"justwms-backend/handlers/bestellungen"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Bestellungen(router *gin.RouterGroup, db *bun.DB) {
	bestellung := router.Group("/bestellungen")
	{
		bestellung.Use(middlewares.Auth(db)).GET("/", func(c *gin.Context) {
			bestellungen.GetBestellungen(c, db)
		})
		bestellung.Use(middlewares.Auth(db)).POST("/", func(c *gin.Context) {
			bestellungen.CreateBestellung(c, db)
		})
		bestellung.Use(middlewares.Admin(db)).PUT("/:id", func(c *gin.Context) {
			bestellungen.UpdateBestellung(c, db)
		})
		bestellung.Use(middlewares.Admin(db)).DELETE("/:id", func(c *gin.Context) {
			bestellungen.DeleteBestellung(c, db)
		})
		bestellung.Use(middlewares.Auth(db)).GET("/:id/export", func(c *gin.Context) {
			bestellungen.Export(c, db)
		})
	}
}
