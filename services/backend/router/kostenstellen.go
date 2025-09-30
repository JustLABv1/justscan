package router

import (
	"justwms-backend/middlewares"

	"justwms-backend/handlers/kostenstellen"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Kostenstellen(router *gin.RouterGroup, db *bun.DB) {
	kostenstelle := router.Group("/kostenstellen")
	{
		kostenstelle.Use(middlewares.Auth(db)).GET("/", func(c *gin.Context) {
			kostenstellen.GetKostenstellen(c, db)
		})
		kostenstelle.Use(middlewares.Admin(db)).POST("/", func(c *gin.Context) {
			kostenstellen.UploadKostenstellen(c, db)
		})
		kostenstelle.Use(middlewares.Auth(db)).POST("/check", func(c *gin.Context) {
			kostenstellen.CheckUploadedKostenstellen(c, db)
		})
	}
}
