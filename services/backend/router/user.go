package router

import (
	notificationhandlers "justscan-backend/handlers/notifications"
	"justscan-backend/handlers/users"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func User(router *gin.RouterGroup, db *bun.DB) {
	user := router.Group("/user").Use(middlewares.Auth(db))
	{
		user.GET("/", func(c *gin.Context) {
			users.GetUserDetails(c, db)
		})

		user.PUT("/", func(c *gin.Context) {
			users.ChangeUserDetails(c, db)
		})
		user.PUT("/password", func(c *gin.Context) {
			users.ChangeUserPassword(c, db)
		})
		user.PUT("/disable", func(c *gin.Context) {
			users.DisableUser(c, db)
		})

		user.DELETE("/", func(c *gin.Context) {
			users.DeleteUser(c, db)
		})

		user.GET("/tokens", func(c *gin.Context) {
			users.ListUserTokens(c, db)
		})
		user.POST("/tokens", func(c *gin.Context) {
			users.CreateUserToken(c, db)
		})
		user.DELETE("/tokens/:tokenId", func(c *gin.Context) {
			users.RevokeUserToken(c, db)
		})

		user.GET("/onboarding/workspace-tour", func(c *gin.Context) {
			users.GetWorkspaceTourState(c, db)
		})
		user.PUT("/onboarding/workspace-tour", func(c *gin.Context) {
			users.UpdateWorkspaceTourState(c, db)
		})

		user.GET("/notifications/channels", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireUserScope(c)
			if !ok {
				return
			}
			notificationhandlers.ListChannels(c, db, scope)
		})
		user.POST("/notifications/channels", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireUserScope(c)
			if !ok {
				return
			}
			notificationhandlers.CreateChannel(c, db, scope)
		})
		user.PUT("/notifications/channels/:channelID", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireUserScope(c)
			if !ok {
				return
			}
			notificationhandlers.UpdateChannel(c, db, scope)
		})
		user.DELETE("/notifications/channels/:channelID", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireUserScope(c)
			if !ok {
				return
			}
			notificationhandlers.DeleteChannel(c, db, scope)
		})
		user.POST("/notifications/channels/:channelID/test", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireUserScope(c)
			if !ok {
				return
			}
			notificationhandlers.TestChannel(c, db, scope)
		})
		user.GET("/notifications/rules", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireUserScope(c)
			if !ok {
				return
			}
			notificationhandlers.ListRules(c, db, scope)
		})
		user.GET("/notifications/condition-options", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireUserScope(c)
			if !ok {
				return
			}
			notificationhandlers.ListConditionOptions(c, db, scope)
		})
		user.POST("/notifications/rules", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireUserScope(c)
			if !ok {
				return
			}
			notificationhandlers.CreateRule(c, db, scope)
		})
		user.PUT("/notifications/rules/:ruleID", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireUserScope(c)
			if !ok {
				return
			}
			notificationhandlers.UpdateRule(c, db, scope)
		})
		user.DELETE("/notifications/rules/:ruleID", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireUserScope(c)
			if !ok {
				return
			}
			notificationhandlers.DeleteRule(c, db, scope)
		})
		user.GET("/notifications/deliveries", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireUserScope(c)
			if !ok {
				return
			}
			notificationhandlers.ListDeliveries(c, db, scope)
		})
		user.GET("/notifications/queue", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireUserScope(c)
			if !ok {
				return
			}
			notificationhandlers.ListQueue(c, db, scope)
		})
		user.POST("/notifications/queue/:jobID/retry", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireUserScope(c)
			if !ok {
				return
			}
			notificationhandlers.RetryQueueJob(c, db, scope)
		})
	}
}
