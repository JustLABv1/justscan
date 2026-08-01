package router

import (
	"justscan-backend/handlers/comments"
	"justscan-backend/handlers/orgs"
	"justscan-backend/handlers/scans"
	"justscan-backend/handlers/tags"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Scans(router *gin.RouterGroup, db *bun.DB) {
	s := router.Group("/scans").Use(middlewares.Auth(db))
	{
		s.GET("/", scans.ListScans(db))
		s.GET("/artifacts", scans.ListScanArtifacts(db))
		s.GET("/images", scans.ListScanImages(db))
		s.DELETE("/images", scans.DeleteScanImageGroup(db))
		s.GET("/images/stats", scans.GetScanImageStats(db))
		s.DELETE("/artifacts", scans.DeleteScanArtifactGroup(db))
		s.GET("/queue-summary", scans.GetQueueSummary(db))
		s.POST("/", scans.CreateScan(db))
		s.POST("/batch", scans.CreateScans(db))
		s.POST("/upload", scans.CreateUploadedArchiveScan(db))
		s.DELETE("/bulk", scans.BulkDeleteScans(db))
		s.POST("/bulk/org-grants", scans.BulkGrantScanOrgAccess(db))
		s.POST("/bulk/transfer-ownership", scans.BulkTransferScanOwnership(db))
		s.POST("/bulk/tags/:tagId", scans.BulkAddTagToScans(db))
		s.GET("/compare", scans.Compare(db))
		s.GET("/trends", scans.GetTrends(db))
		s.GET("/:id", scans.GetScan(db))
		s.GET("/:id/xray-requests", scans.ListScanXRayRequestLogs(db))
		s.PATCH("/:id", scans.UpdateScan(db))
		s.DELETE("/:id", scans.DeleteScan(db))
		s.POST("/:id/cancel", scans.CancelScan(db))
		s.POST("/:id/rescan", scans.ReScan(db))
		s.POST("/:id/xray-policy-refresh", scans.RefreshXrayPolicyViolations(db))
		s.GET("/:id/vulnerability-view", scans.GetVulnerabilityViewSettings(db))
		s.PUT("/:id/vulnerability-view", scans.SaveVulnerabilityViewPreference(db))
		s.DELETE("/:id/vulnerability-view", scans.ResetVulnerabilityViewPreference(db))
		s.GET("/:id/vulnerabilities", scans.ListVulnerabilities(db))
		s.GET("/:id/vulnerabilities/summary", scans.GetVulnerabilitySummary(db))
		s.GET("/:id/vulnerabilities/:vulnerabilityId/analysis", scans.GetVulnerabilityContextAnalysis(db))
		s.GET("/:id/vulnerabilities/:vulnerabilityId/history", scans.GetVulnerabilityHistory(db))
		s.GET("/:id/sbom", scans.GetSBOM(db))
		s.GET("/:id/sbom/graph", scans.GetSBOMGraph(db))
		s.GET("/:id/sbom/components/:componentId", scans.GetSBOMComponent(db))
		s.GET("/:id/sbom/download", scans.DownloadSBOM(db))
		s.GET("/:id/export", scans.ExportScan(db))
		s.POST("/:id/tags/:tagId", tags.AddTagToScan(db))
		s.DELETE("/:id/tags/:tagId", tags.RemoveTagFromScan(db))
		s.POST("/:id/vulnerabilities/:vulnId/comments", comments.CreateComment(db))
		s.GET("/:id/compliance", orgs.GetScanCompliance(db))
		s.POST("/:id/compliance/evaluate", orgs.ReEvaluate(db))
		s.GET("/:id/intelligence/policy-impact", scans.GetIntelligencePolicyImpact(db))
		s.POST("/:id/share", scans.CreateShare(db))
		s.DELETE("/:id/share", scans.DeleteShare(db))
		s.GET("/:id/org-grants", scans.ListScanOrgGrants(db))
		s.POST("/:id/org-grants", scans.GrantScanOrgAccess(db))
		s.DELETE("/:id/org-grants/:orgId", scans.RevokeScanOrgAccess(db))
		s.GET("/:id/manual-findings", scans.ListManualFindings(db))
		s.POST("/:id/manual-findings", scans.CreateManualFinding(db))
		s.PUT("/:id/manual-findings/:fid", scans.UpdateManualFinding(db))
		s.DELETE("/:id/manual-findings/:fid", scans.DeleteManualFinding(db))
	}
}
