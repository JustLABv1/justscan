package helm

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"justscan-backend/config"
	"justscan-backend/functions/auth"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/crypto"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

type extractRequest struct {
	ChartURL                 string `json:"chart_url" binding:"required"`
	ChartName                string `json:"chart_name"`
	ChartVersion             string `json:"chart_version"`
	HelmRegistryCredentialID string `json:"helm_registry_credential_id"`
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

		normalizedChartURL, normalizedChartName, isOCI := scanner.ResolveHelmChartInput(req.ChartURL, req.ChartName)
		if !isOCI && normalizedChartName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "chart_name is required for HTTP repository URLs"})
			return
		}
		if !isOCI && !strings.HasPrefix(normalizedChartURL, "https://") && !strings.HasPrefix(normalizedChartURL, "http://") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "chart_url must use http:// or https:// for HTTP repositories, or oci:// for OCI registries"})
			return
		}

		// Authenticate the caller
		if _, err := auth.GetUserIDFromToken(c.GetHeader("Authorization")); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		credential, err := resolveHelmPullCredential(c, db, normalizedChartURL, isOCI, req.HelmRegistryCredentialID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		images, resolvedName, resolvedVersion, err := scanner.ExtractHelmImages(
			c.Request.Context(),
			normalizedChartURL,
			normalizedChartName,
			req.ChartVersion,
			credential,
		)
		if err != nil {
			log.Warnf("helm extract error for %s: %v", req.ChartURL, err)
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		if images == nil {
			images = make([]scanner.HelmImage, 0)
		}

		c.JSON(http.StatusOK, extractResponse{
			ChartName:    resolvedName,
			ChartVersion: resolvedVersion,
			Images:       images,
		})
	}
}

func resolveHelmPullCredential(c *gin.Context, db *bun.DB, chartURL string, isOCI bool, rawID string) (*scanner.HelmPullCredential, error) {
	if strings.TrimSpace(rawID) == "" {
		return nil, nil
	}
	id, err := uuid.Parse(strings.TrimSpace(rawID))
	if err != nil {
		return nil, fmt.Errorf("invalid Helm registry credential ID")
	}
	userID, _, ok := authz.RequireRequestUser(c, db)
	if !ok {
		return nil, fmt.Errorf("unauthorized")
	}
	credential := &models.HelmRegistryCredential{}
	query := db.NewSelect().Model(credential).Where("id = ?", id)
	scope := c.Query("scope")
	if scope == "" {
		scope = "personal"
	}
	query = authz.ApplyWorkspaceScopeValue(query, "", "owner_user_id", "owner_org_id", "org_helm_registry_credentials", "helm_registry_credential_id", userID, scope)
	if err := query.Scan(c.Request.Context()); err != nil {
		return nil, fmt.Errorf("Helm registry credential is unavailable in this workspace")
	}
	expectedProtocol := models.HelmRegistryProtocolHTTP
	if isOCI {
		expectedProtocol = models.HelmRegistryProtocolOCI
	}
	if credential.Protocol != expectedProtocol || !helmCredentialMatchesChart(credential.URL, chartURL) {
		return nil, fmt.Errorf("Helm registry credential does not match this chart endpoint")
	}
	secret, err := crypto.Decrypt(crypto.KeyFromString(config.Config.Encryption.Key), credential.EncryptedSecret)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt Helm registry credential")
	}
	chart, _ := url.Parse(strings.Replace(chartURL, "oci://", "https://", 1))
	return &scanner.HelmPullCredential{AuthType: credential.AuthType, Host: chart.Host, Username: credential.Username, Secret: secret}, nil
}

func helmCredentialMatchesChart(credentialURL, chartURL string) bool {
	credential, err := url.Parse(strings.Replace(credentialURL, "oci://", "https://", 1))
	if err != nil || credential.Host == "" {
		return false
	}
	chart, err := url.Parse(strings.Replace(chartURL, "oci://", "https://", 1))
	if err != nil || chart.Host == "" || !strings.EqualFold(credential.Host, chart.Host) {
		return false
	}
	credentialPath := strings.Trim(strings.TrimSpace(credential.Path), "/")
	chartPath := strings.Trim(strings.TrimSpace(chart.Path), "/")
	return credentialPath == "" || chartPath == credentialPath || strings.HasPrefix(chartPath, credentialPath+"/")
}
