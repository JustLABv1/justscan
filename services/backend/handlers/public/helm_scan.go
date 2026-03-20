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

		var req struct {
			ChartURL string                `json:"chart_url" binding:"required"`
			Images   []publicHelmScanImage `json:"images" binding:"required,min=1"`
			Platform string                `json:"platform"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		var created []models.Scan
		now := time.Now()

		for _, img := range req.Images {
			name, tag := splitPublicHelmRef(img.FullRef)
			if name == "" {
				continue
			}

			scan := &models.Scan{
				ImageName:      name,
				ImageTag:       tag,
				Platform:       req.Platform,
				Status:         models.ScanStatusPending,
				CreatedAt:      now,
				HelmChart:      req.ChartURL,
				HelmSourcePath: img.SourcePath,
				// UserID is nil — marks as public scan
			}

			if _, err := db.NewInsert().Model(scan).Exec(c.Request.Context()); err != nil {
				log.Errorf("CreatePublicHelmScans DB insert error for %s: %v", img.FullRef, err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create scan for " + img.FullRef})
				return
			}

			scanner.EnqueueScan(scan.ID, db, nil, req.Platform)
			created = append(created, *scan)
		}

		clientIP := c.ClientIP()
		go audit.Write(context.Background(), db, "public", "scan.public.helm.create",
			fmt.Sprintf("Public helm scan created from %s (%d images, ip=%s)", req.ChartURL, len(created), clientIP))

		c.JSON(http.StatusCreated, gin.H{"scans": created})
	}
}

func splitPublicHelmRef(ref string) (name, tag string) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", ""
	}
	idx := strings.LastIndex(ref, ":")
	if idx <= 0 || strings.Contains(ref[idx:], "/") {
		return ref, "latest"
	}
	return ref[:idx], ref[idx+1:]
}
