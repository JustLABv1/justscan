package router

import (
	"justwms-backend/handlers/tokens"
	"justwms-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Token(router *gin.RouterGroup, db *bun.DB) {
	token := router.Group("/token")
	{
		token.GET("/validate", func(c *gin.Context) {
			tokens.ValidateToken(c, db)
		})
		token.POST("/refresh", func(c *gin.Context) {
			tokens.RefreshToken(c, db)
		})
		token.Use(middlewares.Admin(db)).POST("/generate/bridge", func(c *gin.Context) {
			tokens.GenerateTokenBridge(db, c)
		})
		token.PUT("/:id", func(c *gin.Context) {
			tokens.UpdateToken(c, db)
		})
	}
}
