package public

import (
	"net/http"
	"strings"

	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// ExtractPublicHelmImages handles POST /api/v1/public/helm/extract.
// Extracts container images from a publicly accessible Helm chart (no authentication required).
func ExtractPublicHelmImages(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !isPublicScanEnabled(c.Request.Context(), db) {
			c.JSON(http.StatusForbidden, gin.H{"error": "public scanning is currently disabled by the administrator"})
			return
		}

		var req struct {
			ChartURL     string `json:"chart_url" binding:"required"`
			ChartName    string `json:"chart_name"`
			ChartVersion string `json:"chart_version"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		normalizedChartURL, normalizedChartName, isOCI := scanner.ResolveHelmChartInput(req.ChartURL, req.ChartName)
		if !isOCI && normalizedChartName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "chart_name is required for HTTP repository URLs"})
			return
		}
		if !isOCI && !strings.HasPrefix(normalizedChartURL, "https://") && !strings.HasPrefix(normalizedChartURL, "http://") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "chart_url must use http:// or https:// for HTTP repositories, or oci:// for OCI registries"})
			return
		}

		images, resolvedName, resolvedVersion, err := scanner.ExtractHelmImages(
			c.Request.Context(),
			normalizedChartURL,
			normalizedChartName,
			req.ChartVersion,
			nil, // no registry credentials — public charts only
		)
		if err != nil {
			log.Warnf("public helm extract error for %s: %v", req.ChartURL, err)
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		if images == nil {
			images = make([]scanner.HelmImage, 0)
		}

		c.JSON(http.StatusOK, gin.H{
			"chart_name":    resolvedName,
			"chart_version": resolvedVersion,
			"images":        images,
		})
	}
}
