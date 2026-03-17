package router

import (
	"justscan-backend/handlers/orgs"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Orgs(router *gin.RouterGroup, db *bun.DB) {
	r := router.Group("/orgs").Use(middlewares.Auth(db))
	{
		r.GET("/", orgs.ListOrgs(db))
		r.POST("/", orgs.CreateOrg(db))
		r.GET("/:id", orgs.GetOrg(db))
		r.PUT("/:id", orgs.UpdateOrg(db))
		r.DELETE("/:id", orgs.DeleteOrg(db))

		r.GET("/:id/policies", orgs.ListPolicies(db))
		r.POST("/:id/policies", orgs.CreatePolicy(db))
		r.PUT("/:id/policies/:policyId", orgs.UpdatePolicy(db))
		r.DELETE("/:id/policies/:policyId", orgs.DeletePolicy(db))

		r.GET("/:id/compliance/trend", orgs.GetComplianceTrend(db))

		r.GET("/:id/scans", orgs.ListOrgScans(db))
		r.POST("/:id/scans/:scanId", orgs.AssignScan(db))
		r.DELETE("/:id/scans/:scanId", orgs.RemoveScan(db))
	}
}
