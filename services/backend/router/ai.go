package router

import (
	aih "justscan-backend/handlers/ai"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func AI(router *gin.RouterGroup, db *bun.DB) {
	ai := router.Group("/ai").Use(middlewares.Auth(db))
	{
		ai.GET("/settings", aih.GetSettings())
		ai.GET("/providers", aih.ListProviders(db))
		ai.GET("/conversations", aih.ListConversations(db))
		ai.POST("/conversations", aih.CreateConversation(db))
		ai.GET("/conversations/:id", aih.GetConversation(db))
		ai.DELETE("/conversations/:id", aih.DeleteConversation(db))
		ai.POST("/conversations/:id/messages", aih.SendMessage(db))
	}
}
