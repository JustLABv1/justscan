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
	ChartURL string             `json:"chart_url" binding:"required"`
	Images   []scanImageRequest `json:"images" binding:"required,min=1"`
	Platform string             `json:"platform"`
	TagIDs   []string           `json:"tag_ids"`
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

		var created []models.Scan
		now := time.Now()

		for _, img := range req.Images {
			name, tag := splitRef(img.FullRef)
			if name == "" {
				continue
			}

			scan := &models.Scan{
				ImageName:      name,
				ImageTag:       tag,
				Platform:       req.Platform,
				Status:         models.ScanStatusPending,
				UserID:         &userID,
				CreatedAt:      now,
				HelmChart:      req.ChartURL,
				HelmSourcePath: img.SourcePath,
			}

			if _, err := db.NewInsert().Model(scan).Exec(c.Request.Context()); err != nil {
				log.Errorf("CreateHelmScans DB insert error for %s: %v", img.FullRef, err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create scan for " + img.FullRef})
				return
			}

			// Attach tags if provided
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
					db.NewInsert().Model(&scanTags).Exec(c.Request.Context()) //nolint:errcheck
				}
			}

			envVars := resolveImageRegistryEnv(c.Request.Context(), db, name)
			scanner.EnqueueScan(scan.ID, db, envVars, req.Platform)

			created = append(created, *scan)
		}

		go audit.Write(context.Background(), db, userID.String(), "helm.scan",
			fmt.Sprintf("Helm scan created from %s (%d images)", req.ChartURL, len(created)))

		c.JSON(http.StatusCreated, gin.H{"scans": created})
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

// splitRef splits "registry/name:tag" into ("registry/name", "tag").
func splitRef(ref string) (name, tag string) {
	if ref == "" {
		return "", ""
	}
	if idx := strings.Index(ref, "@"); idx != -1 {
		return ref[:idx], ref[idx+1:]
	}
	lastSlash := strings.LastIndex(ref, "/")
	lastColon := strings.LastIndex(ref, ":")
	if lastColon > lastSlash {
		return ref[:lastColon], ref[lastColon+1:]
	}
	return ref, "latest"
}
