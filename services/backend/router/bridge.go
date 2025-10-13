package router

import (
	"justwms-backend/handlers/bridge"
	"justwms-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Bridge(router *gin.RouterGroup, db *bun.DB) {
	bridgeGroup := router.Group("/bridge")
	{
		// Bridge registration (no auth required for bridges to register)
		bridgeGroup.POST("/register", func(c *gin.Context) {
			bridge.RegisterBridge(c, db)
		})

		// Protected endpoints (require authentication)
		bridgeGroup.Use(middlewares.Auth(db)).GET("/", func(c *gin.Context) {
			bridge.ListBridges(c, db)
		})

		bridgeGroup.Use(middlewares.Auth(db)).GET("/active", func(c *gin.Context) {
			bridge.GetActiveBridges(c, db)
		})

		bridgeGroup.Use(middlewares.Auth(db)).DELETE("/:id", func(c *gin.Context) {
			bridge.DeactivateBridge(c, db)
		})
	}
}
