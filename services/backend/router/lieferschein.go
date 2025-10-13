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

		// Download CSV file endpoint
		liefer.Use(middlewares.Auth(db)).GET("/download/:id", func(c *gin.Context) {
			lieferschein.DownloadLieferscheinCSV(c, db)
		})

		// Transfer CSV file to customer server endpoint
		liefer.Use(middlewares.Auth(db)).POST("/transfer", func(c *gin.Context) {
			lieferschein.TransferLieferscheinCSV(c, db)
		})
	}
}
