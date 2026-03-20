package helm

import (
	"context"
	"net/http"
	"strings"

	"justscan-backend/config"
	"justscan-backend/functions/auth"
	"justscan-backend/pkg/crypto"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

type extractRequest struct {
	ChartURL     string `json:"chart_url" binding:"required"`
	ChartName    string `json:"chart_name"`
	ChartVersion string `json:"chart_version"`
}

type extractResponse struct {
	ChartName    string              `json:"chart_name"`
	ChartVersion string              `json:"chart_version"`
	Images       []scanner.HelmImage `json:"images"`
}

// ExtractImages handles POST /api/v1/helm/extract.
// It pulls the chart, renders templates, and returns the list of container images found.
func ExtractImages(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req extractRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		isOCI := strings.HasPrefix(req.ChartURL, "oci://")
		if !isOCI && req.ChartName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "chart_name is required for HTTP repository URLs"})
			return
		}

		// Authenticate the caller
		if _, err := auth.GetUserIDFromToken(c.GetHeader("Authorization")); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		envVars := resolveRegistryEnvByHost(c.Request.Context(), db, req.ChartURL)

		images, resolvedName, resolvedVersion, err := scanner.ExtractHelmImages(
			c.Request.Context(),
			req.ChartURL,
			req.ChartName,
			req.ChartVersion,
			envVars,
		)
		if err != nil {
			log.Warnf("helm extract error for %s: %v", req.ChartURL, err)
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, extractResponse{
			ChartName:    resolvedName,
			ChartVersion: resolvedVersion,
			Images:       images,
		})
	}
}

// resolveRegistryEnvByHost finds registry credentials whose host matches the given URL.
func resolveRegistryEnvByHost(ctx context.Context, db *bun.DB, targetURL string) []string {
	var registries []models.Registry
	if err := db.NewSelect().Model(&registries).Scan(ctx); err != nil {
		return nil
	}

	encKey := crypto.KeyFromString(config.Config.Encryption.Key)

	// Normalise the target to a hostname for matching
	host := strings.TrimPrefix(targetURL, "oci://")
	host = strings.TrimPrefix(host, "https://")
	host = strings.TrimPrefix(host, "http://")
	if idx := strings.Index(host, "/"); idx != -1 {
		host = host[:idx]
	}

	for _, reg := range registries {
		regHost := strings.TrimPrefix(reg.URL, "https://")
		regHost = strings.TrimPrefix(regHost, "http://")
		regHost = strings.TrimSuffix(regHost, "/")

		if regHost != host {
			continue
		}

		password, err := crypto.Decrypt(encKey, reg.Password)
		if err != nil {
			log.Warnf("resolveRegistryEnvByHost: decrypt failed for registry %s: %v", reg.Name, err)
			continue
		}

		switch reg.AuthType {
		case models.RegistryAuthBasic:
			return []string{
				"TRIVY_USERNAME=" + reg.Username,
				"TRIVY_PASSWORD=" + password,
			}
		case models.RegistryAuthToken:
			return []string{
				"TRIVY_REGISTRY_TOKEN=" + password,
			}
		case models.RegistryAuthAWSECR:
			return []string{
				"AWS_ACCESS_KEY_ID=" + reg.Username,
				"AWS_SECRET_ACCESS_KEY=" + password,
			}
		}
	}
	return nil
}
