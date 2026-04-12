package public

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"justscan-backend/functions/audit"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

type publicHelmScanImage struct {
	FullRef    string `json:"full_ref"`
	SourcePath string `json:"source_path"`
}

// CreatePublicHelmScans handles POST /api/v1/public/helm/scan.
// Creates public (anonymous) Scan records for each image extracted from a Helm chart.
func CreatePublicHelmScans(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !isPublicScanEnabled(c.Request.Context(), db) {
			c.JSON(http.StatusForbidden, gin.H{"error": "public scanning is currently disabled by the administrator"})
			return
		}
		if !scanner.TrivyEnabled() {
			c.JSON(http.StatusForbidden, gin.H{"error": "public Helm scanning is unavailable because local Trivy scanning is disabled"})
			return
		}

		var req struct {
			ChartURL     string                `json:"chart_url" binding:"required"`
			ChartName    string                `json:"chart_name"`
			ChartVersion string                `json:"chart_version"`
			Images       []publicHelmScanImage `json:"images" binding:"required,min=1"`
			Platform     string                `json:"platform"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		normalizedChartURL, normalizedChartName, isOCI := scanner.ResolveHelmChartInput(req.ChartURL, req.ChartName)
		if !isOCI && !strings.HasPrefix(normalizedChartURL, "https://") && !strings.HasPrefix(normalizedChartURL, "http://") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "chart_url must use http:// or https:// for HTTP repositories, or oci:// for OCI registries"})
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

			created = make([]models.Scan, 0, len(validImages))
			for _, img := range validImages {
				scan := &models.Scan{
					ImageName:        img.Name,
					ImageTag:         img.Tag,
					Platform:         req.Platform,
					CurrentStep:      models.ScanStepQueued,
					Status:           models.ScanStatusPending,
					CreatedAt:        run.CreatedAt,
					HelmScanRunID:    &run.ID,
					HelmChart:        normalizedChartURL,
					HelmChartName:    normalizedChartName,
					HelmChartVersion: req.ChartVersion,
					HelmSourcePath:   img.SourcePath,
				}

				if _, err := tx.NewInsert().Model(scan).Exec(ctx); err != nil {
					return err
				}

				created = append(created, *scan)
			}

			return nil
		}); err != nil {
			log.Errorf("CreatePublicHelmScans DB insert error for %s: %v", normalizedChartURL, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create Helm scan run"})
			return
		}

		for i := range created {
			scan := &created[i]
			if err := scanner.DispatchScan(c.Request.Context(), db, scan, nil, req.Platform); err != nil {
				log.Warnf("CreatePublicHelmScans dispatch failed for %s: %v", scan.ID, err)
				if markErr := scanner.MarkScanFailed(c.Request.Context(), db, scan.ID, err.Error()); markErr != nil {
					log.Errorf("CreatePublicHelmScans failed to persist dispatch error for %s: %v", scan.ID, markErr)
				} else {
					completedAt := time.Now()
					scan.Status = models.ScanStatusFailed
					scan.CurrentStep = models.ScanStepFailed
					scan.ErrorMessage = err.Error()
					scan.CompletedAt = &completedAt
				}
			}
		}

		clientIP := c.ClientIP()
		go audit.Write(context.Background(), db, "public", "scan.public.helm.create",
			fmt.Sprintf("Public helm scan run %s created from %s (%d images, ip=%s)", run.ID, normalizedChartURL, len(created), clientIP))

		c.JSON(http.StatusCreated, gin.H{"run": run, "scans": created})
	}
}
