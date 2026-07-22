package scans

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
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

type createPipelineScanRequest struct {
	Image          string                  `json:"image" binding:"required"`
	Platform       string                  `json:"platform"`
	RegistryID     string                  `json:"registry_id"`
	XrayRepository string                  `json:"xray_repository"`
	TagIDs         []string                `json:"tag_ids"`
	Source         string                  `json:"source"`
	ExternalRef    string                  `json:"external_ref"`
	Callback       pipelineCallbackRequest `json:"callback"`
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
		tokenID, ok := authz.GetOrgTokenID(c)
		if !ok {
			c.JSON(http.StatusForbidden, gin.H{"error": "org token required"})
			return
		}
		token := &models.Tokens{}
		if err := db.NewSelect().Model(token).Column("description").Where("id = ?", tokenID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "org token required"})
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
				Source:                    source,
				ExternalRef:               req.ExternalRef,
				InitiatorTokenID:          &tokenID,
				InitiatorTokenDescription: token.Description,
				Callback: pipelines.CallbackConfig{
					URL:    req.Callback.URL,
					Secret: req.Callback.Secret,
				},
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
		result, err := pipelines.BuildScanResult(c.Request.Context(), db, req, scan, statusURL)
		if err != nil {
			log.Errorf("GetPipelineScan verdict failed for %s: %v", scanID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to calculate pipeline verdict"})
			return
		}
		c.JSON(http.StatusOK, result)
	}
}

// ListPipelineScans returns recent pipeline-triggered scans for the organization.
// It is intentionally session-authenticated (rather than token-authenticated) so
// people can inspect CI/CD activity without exposing callback secrets.
func ListPipelineScans(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleViewer); !ok {
			return
		}

		page, limit := parsePipelinePagination(c)
		total, err := db.NewSelect().TableExpr("pipeline_scan_requests").
			Where("org_id = ?", orgID).
			Count(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list pipeline scans"})
			return
		}

		// Keep the activity feed available during a rolling deployment: the
		// attribution columns are optional until migration 78 has run.
		hasInitiatorColumns, err := db.NewSelect().
			TableExpr("information_schema.columns").
			Where("table_schema = current_schema() AND table_name = ? AND column_name = ?", "pipeline_scan_requests", "initiator_token_description").
			Exists(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to inspect pipeline scan schema"})
			return
		}

		type pipelineScanRow struct {
			ID                        uuid.UUID  `bun:"id"`
			ScanID                    uuid.UUID  `bun:"scan_id"`
			Source                    string     `bun:"source"`
			InitiatorTokenID          *uuid.UUID `bun:"initiator_token_id"`
			InitiatorTokenDescription string     `bun:"initiator_token_description"`
			ExternalRef               string     `bun:"external_ref"`
			DeliveryStatus            string     `bun:"delivery_status"`
			DeliveryAttemptCount      int        `bun:"delivery_attempt_count"`
			LastDeliveryError         string     `bun:"last_delivery_error"`
			LastAttemptAt             *time.Time `bun:"last_attempt_at"`
			DeliveredAt               *time.Time `bun:"delivered_at"`
			CreatedAt                 time.Time  `bun:"created_at"`
			ScanIDValue               uuid.UUID  `bun:"scan__id"`
			ScanImageName             string     `bun:"scan__image_name"`
			ScanImageTag              string     `bun:"scan__image_tag"`
			ScanStatus                string     `bun:"scan__status"`
			ScanCurrentStep           string     `bun:"scan__current_step"`
			ScanCriticalCount         int        `bun:"scan__critical_count"`
			ScanHighCount             int        `bun:"scan__high_count"`
			ScanCompletedAt           *time.Time `bun:"scan__completed_at"`
		}
		var rows []pipelineScanRow
		query := db.NewSelect().
			TableExpr("pipeline_scan_requests AS pipeline_scan_request").
			Join("JOIN scans AS scan ON scan.id = pipeline_scan_request.scan_id").
			ColumnExpr("pipeline_scan_request.id").
			ColumnExpr("pipeline_scan_request.scan_id").
			ColumnExpr("pipeline_scan_request.source").
			ColumnExpr("pipeline_scan_request.external_ref").
			ColumnExpr("pipeline_scan_request.delivery_status").
			ColumnExpr("pipeline_scan_request.delivery_attempt_count").
			ColumnExpr("pipeline_scan_request.last_delivery_error").
			ColumnExpr("pipeline_scan_request.last_attempt_at").
			ColumnExpr("pipeline_scan_request.delivered_at").
			ColumnExpr("pipeline_scan_request.created_at").
			ColumnExpr("scan.id AS scan__id").
			ColumnExpr("scan.image_name AS scan__image_name").
			ColumnExpr("scan.image_tag AS scan__image_tag").
			ColumnExpr("scan.status AS scan__status").
			ColumnExpr("scan.current_step AS scan__current_step").
			ColumnExpr("scan.critical_count AS scan__critical_count").
			ColumnExpr("scan.high_count AS scan__high_count").
			ColumnExpr("scan.completed_at AS scan__completed_at")
		if hasInitiatorColumns {
			query = query.
				ColumnExpr("pipeline_scan_request.initiator_token_id").
				ColumnExpr("pipeline_scan_request.initiator_token_description")
		}
		if err := query.
			Where("pipeline_scan_request.org_id = ?", orgID).
			OrderExpr("pipeline_scan_request.created_at DESC").
			Limit(limit).
			Offset((page - 1) * limit).
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list pipeline scans"})
			return
		}

		data := make([]gin.H, 0, len(rows))
		for _, row := range rows {
			data = append(data, gin.H{
				"id":      row.ID,
				"scan_id": row.ScanID,
				"source":  row.Source,
				"initiator": gin.H{
					"source":            row.Source,
					"token_id":          row.InitiatorTokenID,
					"token_description": row.InitiatorTokenDescription,
				},
				"external_ref":           row.ExternalRef,
				"delivery_status":        row.DeliveryStatus,
				"delivery_attempt_count": row.DeliveryAttemptCount,
				"last_delivery_error":    row.LastDeliveryError,
				"last_attempt_at":        row.LastAttemptAt,
				"delivered_at":           row.DeliveredAt,
				"created_at":             row.CreatedAt,
				"scan": gin.H{
					"id":             row.ScanIDValue,
					"image_name":     row.ScanImageName,
					"image_tag":      row.ScanImageTag,
					"status":         row.ScanStatus,
					"current_step":   row.ScanCurrentStep,
					"critical_count": row.ScanCriticalCount,
					"high_count":     row.ScanHighCount,
					"completed_at":   row.ScanCompletedAt,
				},
			})
		}
		c.JSON(http.StatusOK, gin.H{"data": data, "total": total, "page": page, "limit": limit})
	}
}

func parsePipelinePagination(c *gin.Context) (int, int) {
	page, limit := 1, 20
	if value, err := strconv.Atoi(c.DefaultQuery("page", "1")); err == nil && value > 0 {
		page = value
	}
	if value, err := strconv.Atoi(c.DefaultQuery("limit", "20")); err == nil && value > 0 && value <= 100 {
		limit = value
	}
	return page, limit
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
