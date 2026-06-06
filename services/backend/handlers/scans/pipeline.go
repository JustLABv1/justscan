package scans

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"

	"justscan-backend/config"
	"justscan-backend/functions/authz"
	"justscan-backend/pipelines"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

type pipelineCallbackRequest struct {
	URL    string `json:"url"`
	Secret string `json:"secret"`
}

type pipelineVerdictRequest struct {
	FailOnSeverity  string `json:"fail_on_severity"`
	FailOnScanError *bool  `json:"fail_on_scan_error"`
	FailOnXrayBlock *bool  `json:"fail_on_xray_block"`
}

type createPipelineScanRequest struct {
	Image          string                  `json:"image" binding:"required"`
	Platform       string                  `json:"platform"`
	RegistryID     string                  `json:"registry_id"`
	XrayRepository string                  `json:"xray_repository"`
	TagIDs         []string                `json:"tag_ids"`
	Source         string                  `json:"source"`
	ExternalRef    string                  `json:"external_ref"`
	Callback       pipelineCallbackRequest `json:"callback"`
	Verdict        pipelineVerdictRequest  `json:"verdict"`
}

func CreatePipelineScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, org, ok := requirePipelineOrgToken(c, db)
		if !ok {
			return
		}
		if !authz.EnsureOrgActionAllowed(c, org, "image_scan") {
			return
		}

		var req createPipelineScanRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		source := pipelines.NormalizeSource(req.Source)
		if source == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid source"})
			return
		}

		if callbackURL := strings.TrimSpace(req.Callback.URL); callbackURL != "" {
			if !strings.HasPrefix(strings.ToLower(callbackURL), "https://") {
				c.JSON(http.StatusBadRequest, gin.H{"error": "callback.url must use https"})
				return
			}
		}

		imageRef := strings.TrimSpace(req.Image)
		_, imageName, imageTag := scanner.NormalizeHelmImageRef(imageRef)
		if imageName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid image reference"})
			return
		}

		registry, envVars, err := resolvePipelineRegistry(c.Request.Context(), db, orgID, imageName, strings.TrimSpace(req.RegistryID))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		provider, err := scanner.ProviderForRegistry(registry)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		normalizedImageName, normalizedImageTag := scanner.NormalizeScanTargetWithXrayRepository(imageName, imageTag, registry, req.XrayRepository)

		verdictConfig := normalizePipelineVerdictRequest(req.Verdict)
		now := time.Now().UTC()
		scan := &models.Scan{
			ImageName:    normalizedImageName,
			ImageTag:     normalizedImageTag,
			Platform:     strings.TrimSpace(req.Platform),
			ScanProvider: provider,
			ScanSource:   models.ScanSourceRegistry,
			CurrentStep:  models.ScanStepQueued,
			Status:       models.ScanStatusPending,
			OwnerType:    models.OwnerTypeOrg,
			OwnerOrgID:   &orgID,
			CreatedAt:    now,
		}
		if registry != nil {
			scan.RegistryID = &registry.ID
		}

		err = db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.NewInsert().Model(scan).Exec(ctx); err != nil {
				return err
			}
			if err := EnsureOrgScanLink(ctx, tx, orgID, scan.ID); err != nil {
				return err
			}
			if len(req.TagIDs) > 0 {
				var scanTags []models.ScanTag
				for _, tagIDStr := range req.TagIDs {
					tagID, err := uuid.Parse(strings.TrimSpace(tagIDStr))
					if err != nil {
						continue
					}
					scanTags = append(scanTags, models.ScanTag{ScanID: scan.ID, TagID: tagID})
				}
				if len(scanTags) > 0 {
					if _, err := tx.NewInsert().Model(&scanTags).On("CONFLICT DO NOTHING").Exec(ctx); err != nil {
						return err
					}
				}
			}
			return pipelines.CreateScanRequest(ctx, tx, scan.ID.String(), orgID.String(), pipelines.ScanCreateConfig{
				Source:      source,
				ExternalRef: req.ExternalRef,
				Callback: pipelines.CallbackConfig{
					URL:    req.Callback.URL,
					Secret: req.Callback.Secret,
				},
				VerdictConfig: verdictConfig,
			})
		})
		if err != nil {
			log.Errorf("CreatePipelineScan transaction failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create pipeline scan"})
			return
		}

		if err := scanner.DispatchScan(c.Request.Context(), db, scan, envVars, req.Platform); err != nil {
			log.Warnf("CreatePipelineScan dispatch failed for %s: %v", scan.ID, err)
			if markErr := scanner.MarkScanFailed(c.Request.Context(), db, scan.ID, err.Error()); markErr != nil {
				log.Errorf("CreatePipelineScan failed to persist dispatch error for %s: %v", scan.ID, markErr)
			}
			if queueErr := pipelines.QueueCallbackForScan(c.Request.Context(), db, scan.ID.String()); queueErr != nil && queueErr != sql.ErrNoRows {
				log.Warnf("CreatePipelineScan failed to queue callback for %s: %v", scan.ID, queueErr)
			}
		}

		statusURL := buildPipelineStatusURL(c, orgID, scan.ID)
		c.JSON(http.StatusAccepted, gin.H{
			"scan_id":     scan.ID,
			"status":      "accepted",
			"scan_status": scan.Status,
			"status_url":  statusURL,
			"scan_url":    buildFrontendScanURL(scan.ID),
		})
	}
}

func GetPipelineScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, _, ok := requirePipelineOrgToken(c, db)
		if !ok {
			return
		}

		scanID, err := uuid.Parse(c.Param("scanId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		req, err := pipelines.LoadScanRequest(c.Request.Context(), db, scanID.String())
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "pipeline scan not found"})
			return
		}
		if req.OrgID != orgID {
			c.JSON(http.StatusNotFound, gin.H{"error": "pipeline scan not found"})
			return
		}

		scan := &models.Scan{}
		if err := db.NewSelect().Model(scan).Where("id = ?", scanID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "pipeline scan not found"})
			return
		}

		statusURL := buildPipelineStatusURL(c, orgID, scanID)
		c.JSON(http.StatusOK, pipelines.BuildScanResult(req, scan, statusURL))
	}
}

func requirePipelineOrgToken(c *gin.Context, db *bun.DB) (uuid.UUID, *models.Org, bool) {
	orgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
		return uuid.Nil, nil, false
	}

	tokenOrgID, ok := authz.GetOrgTokenOrgID(c)
	if !ok || tokenOrgID != orgID {
		c.JSON(http.StatusForbidden, gin.H{"error": "org token required"})
		return uuid.Nil, nil, false
	}

	org, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin)
	if !ok {
		return uuid.Nil, nil, false
	}
	return orgID, org, true
}

func resolvePipelineRegistry(ctx context.Context, db *bun.DB, orgID uuid.UUID, imageName, registryID string) (*models.Registry, []string, error) {
	if trimmed := strings.TrimSpace(registryID); trimmed != "" {
		parsedRegistryID, err := uuid.Parse(trimmed)
		if err != nil {
			return nil, nil, err
		}
		registry, err := authz.LoadAccessibleRegistryForOrg(ctx, db, orgID, parsedRegistryID)
		if err != nil {
			if err == sql.ErrNoRows {
				return nil, nil, err
			}
			return nil, nil, err
		}
		_, envVars, err := scanner.ResolveRegistryForScan(ctx, db, imageName, &registry.ID)
		if err != nil {
			return nil, nil, err
		}
		return registry, envVars, nil
	}

	var registries []models.Registry
	if err := db.NewSelect().Model(&registries).OrderExpr("created_at DESC").Scan(ctx); err != nil {
		return nil, nil, err
	}
	for i := range registries {
		allowed, err := authz.CanOrgAccessRegistry(ctx, db, orgID, &registries[i])
		if err != nil {
			return nil, nil, err
		}
		if !allowed {
			continue
		}
		host := normalizePipelineRegistryHost(registries[i].URL)
		if host != "docker.io" && !strings.HasPrefix(imageName, host+"/") {
			continue
		}
		_, envVars, err := scanner.ResolveRegistryForScan(ctx, db, imageName, &registries[i].ID)
		if err != nil {
			continue
		}
		return &registries[i], envVars, nil
	}

	return nil, nil, nil
}

func normalizePipelineVerdictRequest(req pipelineVerdictRequest) models.PipelineVerdictConfig {
	failOnScanError := true
	if req.FailOnScanError != nil {
		failOnScanError = *req.FailOnScanError
	}
	failOnXrayBlock := true
	if req.FailOnXrayBlock != nil {
		failOnXrayBlock = *req.FailOnXrayBlock
	}
	severity := strings.TrimSpace(strings.ToLower(req.FailOnSeverity))
	if severity == "" {
		severity = "high"
	}
	return models.PipelineVerdictConfig{
		FailOnSeverity:  severity,
		FailOnScanError: failOnScanError,
		FailOnXrayBlock: failOnXrayBlock,
	}
}

func buildPipelineStatusURL(c *gin.Context, orgID, scanID uuid.UUID) string {
	return requestBaseURL(c) + "/api/v1/orgs/" + orgID.String() + "/pipeline-scans/" + scanID.String()
}

func buildFrontendScanURL(scanID uuid.UUID) string {
	baseURL := ""
	if cfg := config.Config; cfg != nil {
		for _, origin := range cfg.AllowOrigins {
			trimmed := strings.TrimRight(strings.TrimSpace(origin), "/")
			if trimmed != "" {
				baseURL = trimmed
				break
			}
		}
	}
	if baseURL == "" {
		return ""
	}
	return baseURL + "/scans/" + scanID.String()
}

func requestBaseURL(c *gin.Context) string {
	scheme := "http"
	if proto := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")); proto != "" {
		scheme = proto
	} else if c.Request.TLS != nil {
		scheme = "https"
	}
	host := strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = c.Request.Host
	}
	if host == "" {
		return ""
	}
	return scheme + "://" + host
}

func normalizePipelineRegistryHost(url string) string {
	host := strings.TrimPrefix(url, "https://")
	host = strings.TrimPrefix(host, "http://")
	host = strings.TrimSuffix(host, "/")
	return host
}
