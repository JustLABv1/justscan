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
		admin.GET("/dashboard", func(c *gin.Context) {
			admins.GetDashboard(c, db)
		})
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
		// insights — API request log
		admin.GET("/api-logs", func(c *gin.Context) {
			admins.GetAPIRequestLogs(c, db)
		})
		admin.GET("/api-usage", func(c *gin.Context) {
			admins.GetAPIUsageStats(c, db)
		})
		// insights — xRay request log
		admin.GET("/xray-usage", func(c *gin.Context) {
			admins.GetXRayUsageStats(c, db)
		})
		admin.GET("/xray-logs", func(c *gin.Context) {
			admins.GetXRayRequestLogs(c, db)
		})
		// log retention settings
		admin.PUT("/settings/api-log-retention", func(c *gin.Context) {
			admins.UpdateAPILogRetention(c, db)
		})
		admin.PUT("/settings/xray-log-retention", func(c *gin.Context) {
			admins.UpdateXRayLogRetention(c, db)
		})
		// scanner & auth settings
		admin.PUT("/settings/scanner", func(c *gin.Context) {
			admins.UpdateScannerSettings(c, db)
		})
		admin.PUT("/settings/auth", func(c *gin.Context) {
			admins.UpdateAuthSettings(c, db)
		})
		// OIDC provider management
		admin.GET("/oidc-providers", func(c *gin.Context) {
			admins.ListOIDCProviders(c, db)
		})
		admin.POST("/oidc-providers", func(c *gin.Context) {
			admins.CreateOIDCProvider(c, db)
		})
		admin.PUT("/oidc-providers/:name", func(c *gin.Context) {
			admins.UpdateOIDCProvider(c, db)
		})
		admin.DELETE("/oidc-providers/:name", func(c *gin.Context) {
			admins.DeleteOIDCProvider(c, db)
		})
		// OIDC group→org mappings
		admin.GET("/oidc-providers/:name/group-mappings", func(c *gin.Context) {
			admins.ListGroupMappings(c, db)
		})
		admin.POST("/oidc-providers/:name/group-mappings", func(c *gin.Context) {
			admins.CreateGroupMapping(c, db)
		})
		admin.PUT("/oidc-providers/:name/group-mappings/:mappingID", func(c *gin.Context) {
			admins.UpdateGroupMapping(c, db)
		})
		admin.DELETE("/oidc-providers/:name/group-mappings/:mappingID", func(c *gin.Context) {
			admins.DeleteGroupMapping(c, db)
		})
		admin.POST("/oidc-providers/:name/claim-sync-preview", func(c *gin.Context) {
			admins.PreviewClaimSync(c, db)
		})
		admin.GET("/oidc-providers/:name/role-overrides", func(c *gin.Context) {
			admins.ListRoleOverrides(c, db)
		})
		admin.POST("/oidc-providers/:name/role-overrides", func(c *gin.Context) {
			admins.CreateRoleOverride(c, db)
		})
		admin.PUT("/oidc-providers/:name/role-overrides/:overrideID", func(c *gin.Context) {
			admins.UpdateRoleOverride(c, db)
		})
		admin.DELETE("/oidc-providers/:name/role-overrides/:overrideID", func(c *gin.Context) {
			admins.DeleteRoleOverride(c, db)
		})
		// global (system) registries
		admin.GET("/registries", func(c *gin.Context) {
			admins.ListGlobalRegistries(c, db)
		})
		admin.POST("/registries", func(c *gin.Context) {
			admins.CreateGlobalRegistry(c, db)
		})
		admin.PUT("/registries/:id", func(c *gin.Context) {
			admins.UpdateGlobalRegistry(c, db)
		})
		admin.DELETE("/registries/:id", func(c *gin.Context) {
			admins.DeleteGlobalRegistry(c, db)
		})
		admin.PUT("/registries/:id/set-default", func(c *gin.Context) {
			admins.SetDefaultRegistry(c, db)
		})
		admin.PUT("/registries/:id/unset-default", func(c *gin.Context) {
			admins.UnsetDefaultRegistry(c, db)
		})
	}
}
