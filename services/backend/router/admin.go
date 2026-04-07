package router

import (
	"justscan-backend/handlers/admins"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Admin(router *gin.RouterGroup, db *bun.DB) {
	admin := router.Group("/admin").Use(middlewares.Admin(db))
	{
		// users
		admin.GET("/users", func(c *gin.Context) {
			admins.GetUsers(c, db)
		})
		admin.POST("/users", func(c *gin.Context) {
			admins.CreateUser(c, db)
		})
		admin.PUT("/users/:userID", func(c *gin.Context) {
			admins.UpdateUser(c, db)
		})
		admin.PUT("/users/:userID/state", func(c *gin.Context) {
			admins.DisableUser(c, db)
		})
		admin.PUT("/users/:userID/disable", func(c *gin.Context) {
			admins.DisableUser(c, db)
		})
		admin.DELETE("/users/:userID", func(c *gin.Context) {
			admins.DeleteUser(c, db)
		})
		// tokens
		admin.GET("/tokens", func(c *gin.Context) {
			admins.GetTokens(c, db)
		})
		admin.PUT("/tokens/:tokenID", func(c *gin.Context) {
			admins.UpdateToken(c, db)
		})
		admin.DELETE("/tokens/:tokenID", func(c *gin.Context) {
			admins.DeleteToken(c, db)
		})
		// system settings
		admin.GET("/settings", func(c *gin.Context) {
			admins.GetSettings(c, db)
		})
		admin.PUT("/settings/public-scan", func(c *gin.Context) {
			admins.UpdatePublicScanEnabled(c, db)
		})
		admin.PUT("/settings/rate-limit", func(c *gin.Context) {
			admins.UpdateRateLimit(c, db)
		})
		admin.PUT("/settings/register-rate-limit", func(c *gin.Context) {
			admins.UpdateRegistrationRateLimit(c, db)
		})
		// all scans (including anonymous public scans)
		admin.GET("/scans", func(c *gin.Context) {
			admins.ListAdminScans(c, db)
		})
		// audit log
		admin.GET("/audit", func(c *gin.Context) {
			admins.GetAuditLogs(c, db)
		})
		// notification channels
		admin.GET("/notifications", func(c *gin.Context) {
			admins.ListNotificationChannels(c, db)
		})
		admin.POST("/notifications", func(c *gin.Context) {
			admins.CreateNotificationChannel(c, db)
		})
		admin.PUT("/notifications/:channelID", func(c *gin.Context) {
			admins.UpdateNotificationChannel(c, db)
		})
		admin.POST("/notifications/:channelID/test", func(c *gin.Context) {
			admins.TestNotificationChannel(c, db)
		})
		admin.GET("/notifications/:channelID/deliveries", func(c *gin.Context) {
			admins.ListNotificationDeliveries(c, db)
		})
		admin.DELETE("/notifications/:channelID", func(c *gin.Context) {
			admins.DeleteNotificationChannel(c, db)
		})
	}
}
