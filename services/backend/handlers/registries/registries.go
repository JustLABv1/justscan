package registries

import (
	"net/http"
	"time"

	"justscan-backend/config"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/crypto"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ListRegistries(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		var registries []models.Registry
		query := db.NewSelect().Model(&registries).
			Column("id", "name", "url", "xray_url", "xray_artifactory_id", "auth_type", "scan_provider", "username", "created_by_id", "created_at", "updated_at", "health_status", "health_message", "last_health_check_at").
			OrderExpr("name ASC")
		if !isAdmin {
			query = query.Where("created_by_id = ?", userID)
		}
		if err := query.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list registries"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": registries, "capabilities": scanner.ScannerCapabilities()})
	}
}

func CreateRegistry(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		var err error
		var body struct {
			Name              string `json:"name" binding:"required"`
			URL               string `json:"url" binding:"required"`
			XrayURL           string `json:"xray_url"`
			XrayArtifactoryID string `json:"xray_artifactory_id"`
			AuthType          string `json:"auth_type" binding:"omitempty,oneof=basic token aws_ecr none"`
			ScanProvider      string `json:"scan_provider" binding:"omitempty,oneof=trivy artifactory_xray"`
			Username          string `json:"username"`
			Password          string `json:"password"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if body.AuthType == "" {
			body.AuthType = models.RegistryAuthNone
		}
		if body.ScanProvider == "" {
			body.ScanProvider = models.ScanProviderTrivy
		}
		if err := scanner.ValidateRegistryProviderSelection(body.ScanProvider); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if body.XrayArtifactoryID == "" {
			body.XrayArtifactoryID = "default"
		}
		encryptedPassword := ""
		if body.Password != "" {
			key := crypto.KeyFromString(config.Config.Encryption.Key)
			encryptedPassword, err = crypto.Encrypt(key, body.Password)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encrypt credentials"})
				return
			}
		}
		registry := &models.Registry{
			Name:              body.Name,
			URL:               body.URL,
			XrayURL:           body.XrayURL,
			XrayArtifactoryID: body.XrayArtifactoryID,
			AuthType:          body.AuthType,
			ScanProvider:      body.ScanProvider,
			Username:          body.Username,
			Password:          encryptedPassword,
			CreatedByID:       userID,
			CreatedAt:         time.Now(),
			UpdatedAt:         time.Now(),
		}
		if _, err := db.NewInsert().Model(registry).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create registry"})
			return
		}
		registry.Password = "" // never return password
		c.JSON(http.StatusCreated, registry)
	}
}

func UpdateRegistry(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		registryID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry ID"})
			return
		}
		var body struct {
			Name              string `json:"name"`
			URL               string `json:"url"`
			XrayURL           string `json:"xray_url"`
			XrayArtifactoryID string `json:"xray_artifactory_id"`
			AuthType          string `json:"auth_type"`
			ScanProvider      string `json:"scan_provider"`
			Username          string `json:"username"`
			Password          string `json:"password"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		registry, _, _, ok := authz.LoadAuthorizedRegistry(c, db, registryID)
		if !ok {
			return
		}
		if body.Name != "" {
			registry.Name = body.Name
		}
		if body.URL != "" {
			registry.URL = body.URL
		}
		if body.XrayURL != "" || registry.ScanProvider == models.ScanProviderArtifactoryXray {
			registry.XrayURL = body.XrayURL
		}
		if body.XrayArtifactoryID != "" {
			registry.XrayArtifactoryID = body.XrayArtifactoryID
		}
		if body.AuthType != "" {
			registry.AuthType = body.AuthType
		}
		if body.ScanProvider != "" {
			registry.ScanProvider = body.ScanProvider
		}
		if err := scanner.ValidateRegistryProviderSelection(registry.ScanProvider); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if body.Username != "" {
			registry.Username = body.Username
		}
		if body.Password != "" {
			key := crypto.KeyFromString(config.Config.Encryption.Key)
			enc, err := crypto.Encrypt(key, body.Password)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encrypt credentials"})
				return
			}
			registry.Password = enc
		}
		registry.UpdatedAt = time.Now()
		if _, err := db.NewUpdate().Model(registry).
			Column("name", "url", "xray_url", "xray_artifactory_id", "auth_type", "scan_provider", "username", "password", "updated_at").
			Where("id = ?", registryID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update registry"})
			return
		}
		registry.Password = ""
		c.JSON(http.StatusOK, registry)
	}
}

func DeleteRegistry(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		registryID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry ID"})
			return
		}
		if _, _, _, ok := authz.LoadAuthorizedRegistry(c, db, registryID); !ok {
			return
		}
		if _, err := db.NewDelete().Model((*models.Registry)(nil)).
			Where("id = ?", registryID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete registry"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}
