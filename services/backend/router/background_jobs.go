package router

import (
	jobhandlers "justscan-backend/handlers/backgroundjobs"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func BackgroundJobs(router *gin.RouterGroup, db *bun.DB) {
	jobs := router.Group("/background-jobs").Use(middlewares.Auth(db))
	{
		jobs.GET("", jobhandlers.List(db))
		jobs.GET("/", jobhandlers.List(db))
		jobs.DELETE("", jobhandlers.DismissMany(db))
		jobs.DELETE("/", jobhandlers.DismissMany(db))
		jobs.GET("/:id", jobhandlers.Get(db))
		jobs.DELETE("/:id", jobhandlers.Dismiss(db))
	}
}
