package router

import (
	notificationhandlers "justscan-backend/handlers/notifications"
	"justscan-backend/handlers/orgs"
	"justscan-backend/handlers/scans"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Orgs(router *gin.RouterGroup, db *bun.DB) {
	r := router.Group("/orgs").Use(middlewares.Auth(db))
	{
		r.GET("/invites", orgs.ListMyInvites(db))
		r.POST("/invites/:inviteId/accept", orgs.AcceptInviteByID(db))
		r.POST("/invites/:inviteId/decline", orgs.DeclineInvite(db))
		r.POST("/invites/by-token/:token/accept", orgs.AcceptInviteByToken(db))
		r.GET("/", orgs.ListOrgs(db))
		r.POST("/", orgs.CreateOrg(db))
		r.GET("/:id", orgs.GetOrg(db))
		r.PUT("/:id", orgs.UpdateOrg(db))
		r.PUT("/:id/vulnerability-view", orgs.UpdateVulnerabilityViewSettings(db))
		r.DELETE("/:id", orgs.DeleteOrg(db))
		r.GET("/:id/members", orgs.ListMembers(db))
		r.PATCH("/:id/members/:userId", orgs.UpdateMemberRole(db))
		r.DELETE("/:id/members/:userId", orgs.RemoveMember(db))
		r.GET("/:id/invites", orgs.ListInvites(db))
		r.POST("/:id/invites", orgs.CreateInvite(db))
		r.DELETE("/:id/invites/:inviteId", orgs.RevokeInvite(db))

		r.GET("/:id/policies", orgs.ListPolicies(db))
		r.POST("/:id/policies", orgs.CreatePolicy(db))
		r.PUT("/:id/policies/:policyId", orgs.UpdatePolicy(db))
		r.DELETE("/:id/policies/:policyId", orgs.DeletePolicy(db))

		r.GET("/:id/compliance/trend", orgs.GetComplianceTrend(db))

		r.GET("/:id/scans", orgs.ListOrgScans(db))
		r.POST("/:id/scans/:scanId", orgs.AssignScan(db))
		r.DELETE("/:id/scans/:scanId", orgs.RemoveScan(db))
		r.POST("/:id/pipeline-scans", scans.CreatePipelineScan(db))
		r.GET("/:id/pipeline-scans", scans.ListPipelineScans(db))
		r.GET("/:id/pipeline-scans/:scanId", scans.GetPipelineScan(db))

		r.GET("/:id/risk", orgs.GetRiskScore(db))

		r.POST("/:id/transfer-ownership", orgs.TransferOwnership(db))

		r.GET("/:id/tokens", orgs.ListOrgTokens(db))
		r.POST("/:id/tokens", orgs.CreateOrgToken(db))
		r.DELETE("/:id/tokens/:tokenId", orgs.RevokeOrgToken(db))

		r.GET("/:id/audit", orgs.ListOrgAuditLog(db))

		r.GET("/:id/notifications/channels", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireOrgViewerScope(c, db)
			if !ok {
				return
			}
			notificationhandlers.ListChannels(c, db, scope)
		})
		r.POST("/:id/notifications/channels", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireOrgAdminScope(c, db)
			if !ok {
				return
			}
			notificationhandlers.CreateChannel(c, db, scope)
		})
		r.PUT("/:id/notifications/channels/:channelID", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireOrgAdminScope(c, db)
			if !ok {
				return
			}
			notificationhandlers.UpdateChannel(c, db, scope)
		})
		r.DELETE("/:id/notifications/channels/:channelID", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireOrgAdminScope(c, db)
			if !ok {
				return
			}
			notificationhandlers.DeleteChannel(c, db, scope)
		})
		r.POST("/:id/notifications/channels/:channelID/test", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireOrgAdminScope(c, db)
			if !ok {
				return
			}
			notificationhandlers.TestChannel(c, db, scope)
		})
		r.GET("/:id/notifications/rules", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireOrgViewerScope(c, db)
			if !ok {
				return
			}
			notificationhandlers.ListRules(c, db, scope)
		})
		r.POST("/:id/notifications/rules", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireOrgAdminScope(c, db)
			if !ok {
				return
			}
			notificationhandlers.CreateRule(c, db, scope)
		})
		r.PUT("/:id/notifications/rules/:ruleID", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireOrgAdminScope(c, db)
			if !ok {
				return
			}
			notificationhandlers.UpdateRule(c, db, scope)
		})
		r.DELETE("/:id/notifications/rules/:ruleID", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireOrgAdminScope(c, db)
			if !ok {
				return
			}
			notificationhandlers.DeleteRule(c, db, scope)
		})
		r.GET("/:id/notifications/deliveries", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireOrgViewerScope(c, db)
			if !ok {
				return
			}
			notificationhandlers.ListDeliveries(c, db, scope)
		})
		r.GET("/:id/notifications/queue", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireOrgViewerScope(c, db)
			if !ok {
				return
			}
			notificationhandlers.ListQueue(c, db, scope)
		})
		r.POST("/:id/notifications/queue/:jobID/retry", func(c *gin.Context) {
			scope, ok := notificationhandlers.RequireOrgAdminScope(c, db)
			if !ok {
				return
			}
			notificationhandlers.RetryQueueJob(c, db, scope)
		})
	}
}
