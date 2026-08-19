package router

import (
	"justscan-backend/handlers/gitrepositories"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func GitRepositories(router *gin.RouterGroup, db *bun.DB) {
	r := router.Group("/git-repositories").Use(middlewares.Auth(db))
	{
		r.GET("/", gitrepositories.List(db))
		r.POST("/", gitrepositories.Create(db))
		r.POST("/validate", gitrepositories.Validate(db))
		r.GET("/:id", gitrepositories.Get(db))
		r.PUT("/:id", gitrepositories.Update(db))
		r.DELETE("/:id", gitrepositories.Delete(db))
		r.GET("/:id/runs", gitrepositories.ListRuns(db))
		r.GET("/:id/latest-image-scans", gitrepositories.ListLatestImageScans(db))
		r.POST("/:id/runs", gitrepositories.CreateRun(db))
		r.POST("/:id/runs/:runId/cancel", gitrepositories.CancelRun(db))
		r.GET("/:id/image-exclusions", gitrepositories.ListImageExclusions(db))
		r.POST("/:id/image-exclusions", gitrepositories.CreateImageExclusion(db))
		r.DELETE("/:id/image-exclusions/:exclusionId", gitrepositories.DeleteImageExclusion(db))
		r.GET("/:id/image-registry-overrides", gitrepositories.ListImageRegistryOverrides(db))
		r.PUT("/:id/image-registry-overrides", gitrepositories.SetImageRegistryOverride(db))
		r.DELETE("/:id/image-registry-overrides/:overrideId", gitrepositories.DeleteImageRegistryOverride(db))
		r.POST("/:id/discover", gitrepositories.Discover(db))
		r.GET("/:id/runs/:runId", gitrepositories.GetRun(db))
		r.GET("/:id/runs/:runId/candidates", gitrepositories.ListCandidates(db))
		r.GET("/:id/discovery-rules", gitrepositories.ListRules(db))
		r.POST("/:id/discovery-rules", gitrepositories.CreateRule(db))
		r.DELETE("/:id/discovery-rules/:ruleId", gitrepositories.DeleteRule(db))
		r.GET("/:id/discovery-rules/export", gitrepositories.ExportRules(db))
		r.GET("/:id/helm-sources", gitrepositories.ListHelmSources(db))
		r.POST("/:id/helm-sources", gitrepositories.CreateHelmSource(db))
		r.PUT("/:id/helm-sources/:sourceId", gitrepositories.UpdateHelmSource(db))
		r.DELETE("/:id/helm-sources/:sourceId", gitrepositories.DeleteHelmSource(db))
	}
}
