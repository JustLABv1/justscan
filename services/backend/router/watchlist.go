package router

import (
	"justscan-backend/handlers/watchlist"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Watchlist(router *gin.RouterGroup, db *bun.DB) {
	w := router.Group("/watchlist").Use(middlewares.Auth(db))
	{
		w.GET("/", watchlist.ListWatchlist(db))
		w.POST("/", watchlist.CreateWatchlistItem(db))
		w.PUT("/:id", watchlist.UpdateWatchlistItem(db))
		w.DELETE("/:id", watchlist.DeleteWatchlistItem(db))
		w.GET("/:id/shares", watchlist.ListWatchlistShares(db))
		w.POST("/:id/shares", watchlist.ShareWatchlistItem(db))
		w.DELETE("/:id/shares/:orgId", watchlist.UnshareWatchlistItem(db))
		w.POST("/:id/scan", watchlist.TriggerScan(db))
	}
}
