package scans

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

type CreateScanRequest struct {
	Image    string   `json:"image" binding:"required"`
	Tag      string   `json:"tag" binding:"required"`
	Platform string   `json:"platform"`
	TagIDs   []string `json:"tag_ids"`
}

func CreateScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateScanRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		userID, err := auth.GetUserIDFromToken(c.GetHeader("Authorization"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		scan := &models.Scan{
			ImageName: req.Image,
			ImageTag:  req.Tag,
			Platform:  req.Platform,
			Status:    models.ScanStatusPending,
			UserID:    &userID,
			CreatedAt: time.Now(),
		}
		if _, err := db.NewInsert().Model(scan).Exec(c.Request.Context()); err != nil {
			log.Errorf("CreateScan DB insert error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create scan"})
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

		// Resolve registry credentials and enqueue scan
		envVars := resolveRegistryEnv(c.Request.Context(), db, req.Image)
		scanner.EnqueueScan(scan.ID, db, envVars, req.Platform)

		go audit.Write(context.Background(), db, userID.String(), "scan.create",
			fmt.Sprintf("Scan created for %s:%s (id=%s)", req.Image, req.Tag, scan.ID))

		c.JSON(http.StatusCreated, scan)
	}
}

// resolveRegistryEnv matches the image name to a stored registry and returns
// Trivy-compatible environment variables for authentication.
func resolveRegistryEnv(ctx context.Context, db *bun.DB, imageName string) []string {
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
			log.Warnf("resolveRegistryEnv: failed to decrypt password for registry %s: %v", reg.Name, err)
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
			// AWS ECR: username is AWS_ACCESS_KEY_ID, password is AWS_SECRET_ACCESS_KEY
			return []string{
				"AWS_ACCESS_KEY_ID=" + reg.Username,
				"AWS_SECRET_ACCESS_KEY=" + password,
			}
		}
	}
	return nil
}
