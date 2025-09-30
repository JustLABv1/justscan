package router

import (
	"github.com/JustNZ/JustWMS/services/backend/middlewares"

	"github.com/JustNZ/JustWMS/services/backend/handlers/bestellungen"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Bestellungen(router *gin.RouterGroup, db *bun.DB) {
	bestellung := router.Group("/bestellungen").Use(middlewares.Auth(db))
	{
		bestellung.GET("/", func(c *gin.Context) {
			bestellungen.GetBestellungen(c, db)
		})
		bestellung.POST("/", func(c *gin.Context) {
			bestellungen.CreateBestellung(c, db)
		})
		bestellung.PUT("/:id", func(c *gin.Context) {
			bestellungen.UpdateBestellung(c, db)
		})
		bestellung.DELETE("/:id", func(c *gin.Context) {
			bestellungen.DeleteBestellung(c, db)
		})
		bestellung.GET("/:id/export", func(c *gin.Context) {
			bestellungen.Export(c, db)
		})
	}
}
