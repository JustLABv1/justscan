package router

import (
	"justwms/middlewares"

	"justwms/handlers/kostenstellen"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Kostenstellen(router *gin.RouterGroup, db *bun.DB) {
	kostenstelle := router.Group("/kostenstellen").Use(middlewares.Auth(db))
	{
		kostenstelle.GET("/", func(c *gin.Context) {
			kostenstellen.GetKostenstellen(c, db)
		})
		kostenstelle.POST("/", func(c *gin.Context) {
			kostenstellen.UploadKostenstellen(c, db)
		})
		kostenstelle.POST("/check", func(c *gin.Context) {
			kostenstellen.CheckUploadedKostenstellen(c, db)
		})
	}
}
