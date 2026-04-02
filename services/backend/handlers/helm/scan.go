package helm

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"justscan-backend/config"
	"justscan-backend/functions/audit"
	"justscan-backend/functions/auth"
	"justscan-backend/pkg/crypto"
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

		userID, err := auth.GetUserIDFromToken(c.GetHeader("Authorization"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		type normalizedScanImage struct {
			Name       string
			Tag        string
			SourcePath string
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

		run := &models.HelmScanRun{
			UserID:       &userID,
			ChartURL:     req.ChartURL,
			ChartName:    req.ChartName,
			ChartVersion: req.ChartVersion,
			Platform:     req.Platform,
			CreatedAt:    time.Now(),
		}
		var created []models.Scan
		if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.NewInsert().Model(run).Exec(ctx); err != nil {
				return err
			}

			created = make([]models.Scan, 0, len(validImages))
			for _, img := range validImages {
				scan := &models.Scan{
					ImageName:        img.Name,
					ImageTag:         img.Tag,
					Platform:         req.Platform,
					Status:           models.ScanStatusPending,
					UserID:           &userID,
					CreatedAt:        run.CreatedAt,
					HelmScanRunID:    &run.ID,
					HelmChart:        req.ChartURL,
					HelmChartName:    req.ChartName,
					HelmChartVersion: req.ChartVersion,
					HelmSourcePath:   img.SourcePath,
				}

				if _, err := tx.NewInsert().Model(scan).Exec(ctx); err != nil {
					return err
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

				created = append(created, *scan)
			}

			return nil
		}); err != nil {
			log.Errorf("CreateHelmScans DB insert error for run %s: %v", req.ChartURL, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create Helm scan run"})
			return
		}

		for _, scan := range created {
			envVars := resolveImageRegistryEnv(c.Request.Context(), db, scan.ImageName)
			scanner.EnqueueScan(scan.ID, db, envVars, req.Platform)
		}

		go audit.Write(context.Background(), db, userID.String(), "helm.scan",
			fmt.Sprintf("Helm scan run %s created from %s (%d images)", run.ID, req.ChartURL, len(created)))

		c.JSON(http.StatusCreated, gin.H{"run": run, "scans": created})
	}
}

// resolveImageRegistryEnv matches an image name against stored registries to find credentials.
func resolveImageRegistryEnv(ctx context.Context, db *bun.DB, imageName string) []string {
	var registries []models.Registry
	if err := db.NewSelect().Model(&registries).Scan(ctx); err != nil {
		return nil
	}

	encKey := crypto.KeyFromString(config.Config.Encryption.Key)

	for _, reg := range registries {
		host := strings.TrimPrefix(reg.URL, "https://")
		host = strings.TrimPrefix(host, "http://")
		host = strings.TrimSuffix(host, "/")

		if !strings.HasPrefix(imageName, host+"/") && host != "docker.io" {
			continue
		}

		password, err := crypto.Decrypt(encKey, reg.Password)
		if err != nil {
			log.Warnf("resolveImageRegistryEnv: decrypt failed for registry %s: %v", reg.Name, err)
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
