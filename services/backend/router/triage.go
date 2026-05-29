package router

import (
	"justscan-backend/handlers/triage"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Triage(router *gin.RouterGroup, db *bun.DB) {
	t := router.Group("/triage").Use(middlewares.Auth(db))
	{
		t.GET("/", triage.GetTriage(db))
	}
}
