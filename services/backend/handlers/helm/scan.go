package helm

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"justscan-backend/functions/audit"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

type scanImageRequest struct {
	FullRef    string `json:"full_ref"`
	SourcePath string `json:"source_path"`
}

type createScansRequest struct {
	ChartURL     string             `json:"chart_url" binding:"required"`
	ChartName    string             `json:"chart_name"`
	ChartVersion string             `json:"chart_version"`
	Images       []scanImageRequest `json:"images" binding:"required,min=1"`
	Platform     string             `json:"platform"`
	RegistryID   string             `json:"registry_id"`
	OrgID        string             `json:"org_id"`
	TagIDs       []string           `json:"tag_ids"`
}

// CreateScans handles POST /api/v1/helm/scan.
// For each image in the request it creates a Scan record linked to the chart URL
// and immediately enqueues the scan job.
func CreateScans(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req createScansRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		normalizedChartURL, normalizedChartName, isOCI := scanner.ResolveHelmChartInput(req.ChartURL, req.ChartName)
		if !isOCI && !strings.HasPrefix(normalizedChartURL, "https://") && !strings.HasPrefix(normalizedChartURL, "http://") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "chart_url must use http:// or https:// for HTTP repositories, or oci:// for OCI registries"})
			return
		}

		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		type normalizedScanImage struct {
			Name       string
			Tag        string
			SourcePath string
		}
		type preparedHelmScan struct {
			Scan    models.Scan
			EnvVars []string
		}

		validImages := make([]normalizedScanImage, 0, len(req.Images))
		for _, img := range req.Images {
			_, name, tag := scanner.NormalizeHelmImageRef(img.FullRef)
			if name == "" {
				continue
			}
			validImages = append(validImages, normalizedScanImage{
				Name:       name,
				Tag:        tag,
				SourcePath: img.SourcePath,
			})
		}
		if len(validImages) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no valid images found in request"})
			return
		}

		var requestedRegistryID *uuid.UUID
		var requestedOrgID *uuid.UUID
		if req.RegistryID != "" {
			parsedRegistryID, err := uuid.Parse(req.RegistryID)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry_id"})
				return
			}
			if _, _, _, ok := authz.LoadAuthorizedRegistry(c, db, parsedRegistryID); !ok {
				return
			}
			requestedRegistryID = &parsedRegistryID
		}
		if req.OrgID != "" {
			parsedOrgID, err := uuid.Parse(req.OrgID)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
				return
			}
			if _, _, _, _, ok := authz.RequireOrgRole(c, db, parsedOrgID, models.OrgRoleMember); !ok {
				return
			}
			requestedOrgID = &parsedOrgID
		}

		preparedScans := make([]preparedHelmScan, 0, len(validImages))
		for _, img := range validImages {
			registry, envVars, err := scanner.ResolveRegistryForScan(c.Request.Context(), db, img.Name, requestedRegistryID)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			provider, err := scanner.ProviderForRegistry(registry)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}

			normalizedImageName, normalizedImageTag := scanner.NormalizeScanTarget(img.Name, img.Tag, registry)
			scan := models.Scan{
				ImageName:        normalizedImageName,
				ImageTag:         normalizedImageTag,
				Platform:         req.Platform,
				CurrentStep:      models.ScanStepQueued,
				Status:           models.ScanStatusPending,
				UserID:           &userID,
				OwnerType:        models.OwnerTypeUser,
				OwnerUserID:      &userID,
				CreatedAt:        time.Now(),
				HelmChart:        normalizedChartURL,
				HelmChartName:    normalizedChartName,
				HelmChartVersion: req.ChartVersion,
				HelmSourcePath:   img.SourcePath,
				ScanProvider:     provider,
			}
			if requestedOrgID != nil {
				scan.OwnerType = models.OwnerTypeOrg
				scan.OwnerUserID = nil
				scan.OwnerOrgID = requestedOrgID
			}
			if registry != nil {
				scan.RegistryID = &registry.ID
			}

			preparedScans = append(preparedScans, preparedHelmScan{Scan: scan, EnvVars: envVars})
		}

		run := &models.HelmScanRun{
			UserID:       &userID,
			ChartURL:     normalizedChartURL,
			ChartName:    normalizedChartName,
			ChartVersion: req.ChartVersion,
			Platform:     req.Platform,
			CreatedAt:    time.Now(),
		}
		var created []models.Scan
		if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.NewInsert().Model(run).Exec(ctx); err != nil {
				return err
			}

			created = make([]models.Scan, 0, len(preparedScans))
			for _, prepared := range preparedScans {
				scan := prepared.Scan
				scan.CreatedAt = run.CreatedAt
				scan.HelmScanRunID = &run.ID

				if _, err := tx.NewInsert().Model(&scan).Exec(ctx); err != nil {
					return err
				}
				if requestedOrgID != nil {
					if _, err := tx.NewInsert().Model(&models.OrgScan{OrgID: *requestedOrgID, ScanID: scan.ID}).On("CONFLICT DO NOTHING").Exec(ctx); err != nil {
						return err
					}
				}

				if len(req.TagIDs) > 0 {
					var scanTags []models.ScanTag
					for _, tagIDStr := range req.TagIDs {
						tagID, err := uuid.Parse(tagIDStr)
						if err != nil {
							continue
						}
						scanTags = append(scanTags, models.ScanTag{ScanID: scan.ID, TagID: tagID})
					}
					if len(scanTags) > 0 {
						if _, err := tx.NewInsert().Model(&scanTags).Exec(ctx); err != nil {
							return err
						}
					}
				}

				preparedScans[len(created)].Scan = scan
				created = append(created, scan)
			}

			return nil
		}); err != nil {
			log.Errorf("CreateHelmScans DB insert error for run %s: %v", normalizedChartURL, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create Helm scan run"})
			return
		}

		for i := range created {
			scan := &created[i]
			if err := scanner.DispatchScan(c.Request.Context(), db, scan, preparedScans[i].EnvVars, req.Platform); err != nil {
				log.Warnf("CreateHelmScans dispatch failed for %s: %v", scan.ID, err)
				if markErr := scanner.MarkScanFailed(c.Request.Context(), db, scan.ID, err.Error()); markErr != nil {
					log.Errorf("CreateHelmScans failed to persist dispatch error for %s: %v", scan.ID, markErr)
				} else {
					completedAt := time.Now()
					scan.Status = models.ScanStatusFailed
					scan.CurrentStep = models.ScanStepFailed
					scan.ErrorMessage = err.Error()
					scan.CompletedAt = &completedAt
				}
			}
		}

		go audit.Write(context.Background(), db, userID.String(), "helm.scan",
			fmt.Sprintf("Helm scan run %s created from %s (%d images)", run.ID, normalizedChartURL, len(created)))

		c.JSON(http.StatusCreated, gin.H{"run": run, "scans": created})
	}
}
