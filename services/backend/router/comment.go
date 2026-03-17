package router

import (
	"justscan-backend/handlers/comments"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Comments(router *gin.RouterGroup, db *bun.DB) {
	auth := router.Group("").Use(middlewares.Auth(db))
	{
		auth.PUT("/comments/:id", comments.UpdateComment(db))
		auth.DELETE("/comments/:id", comments.DeleteComment(db))
	}
}
