package admins

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/crypto"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type globalRegistryPayload struct {
	Name              *string `json:"name" binding:"omitempty"`
	URL               *string `json:"url" binding:"omitempty"`
	XrayURL           *string `json:"xray_url"`
	XrayArtifactoryID *string `json:"xray_artifactory_id"`
	AuthType          *string `json:"auth_type" binding:"omitempty,oneof=basic token aws_ecr none"`
	ScanProvider      *string `json:"scan_provider" binding:"omitempty,oneof=trivy artifactory_xray"`
	Username          *string `json:"username"`
	Password          *string `json:"password"`
}

// ListGlobalRegistries returns all system-owned registries.
func ListGlobalRegistries(c *gin.Context, db *bun.DB) {
	var registries []models.Registry
	if err := db.NewSelect().Model(&registries).
		Where("owner_type = ?", models.OwnerTypeSystem).
		OrderExpr("name ASC").
		Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list global registries"})
		return
	}
	for i := range registries {
		registries[i].Password = ""
	}
	c.JSON(http.StatusOK, gin.H{"data": registries, "capabilities": scanner.ScannerCapabilities()})
}

// CreateGlobalRegistry creates a new system-owned registry.
func CreateGlobalRegistry(c *gin.Context, db *bun.DB) {
	userID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var body globalRegistryPayload
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	name := strings.TrimSpace(stringValue(body.Name))
	url := strings.TrimSpace(stringValue(body.URL))
	if name == "" || url == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name and url are required"})
		return
	}
	authType := models.RegistryAuthNone
	if body.AuthType != nil && strings.TrimSpace(*body.AuthType) != "" {
		authType = strings.TrimSpace(*body.AuthType)
	}
	scanProvider := models.ScanProviderTrivy
	if body.ScanProvider != nil && strings.TrimSpace(*body.ScanProvider) != "" {
		scanProvider = strings.TrimSpace(*body.ScanProvider)
	}
	if err := scanner.ValidateRegistryProviderSelection(scanProvider); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	xrayURL := strings.TrimSpace(stringValue(body.XrayURL))
	xrayArtifactoryID := strings.TrimSpace(stringValue(body.XrayArtifactoryID))
	if scanProvider == models.ScanProviderArtifactoryXray {
		if xrayArtifactoryID == "" {
			xrayArtifactoryID = "default"
		}
	} else {
		xrayURL = ""
		xrayArtifactoryID = "default"
	}
	username := strings.TrimSpace(stringValue(body.Username))
	encryptedPassword := ""
	if body.Password != nil && strings.TrimSpace(*body.Password) != "" {
		key := crypto.KeyFromString(config.Config.Encryption.Key)
		enc, err := crypto.Encrypt(key, strings.TrimSpace(*body.Password))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encrypt credentials"})
			return
		}
		encryptedPassword = enc
	}
	registry := &models.Registry{
		Name:              name,
		URL:               url,
		XrayURL:           xrayURL,
		XrayArtifactoryID: xrayArtifactoryID,
		AuthType:          authType,
		ScanProvider:      scanProvider,
		Username:          username,
		Password:          encryptedPassword,
		CreatedByID:       userID,
		OwnerType:         models.OwnerTypeSystem,
		CreatedAt:         time.Now(),
		UpdatedAt:         time.Now(),
	}
	if _, err := db.NewInsert().Model(registry).Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create global registry"})
		return
	}
	registry.Password = ""
	c.JSON(http.StatusCreated, registry)
}

// UpdateGlobalRegistry updates an existing system-owned registry.
func UpdateGlobalRegistry(c *gin.Context, db *bun.DB) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry ID"})
		return
	}

	var body globalRegistryPayload
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	registry := new(models.Registry)
	if err := db.NewSelect().Model(registry).
		Where("id = ? AND owner_type = ?", id, models.OwnerTypeSystem).
		Scan(c.Request.Context()); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "registry not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load registry"})
		return
	}

	if body.Name != nil {
		registry.Name = strings.TrimSpace(*body.Name)
	}
	if body.URL != nil {
		registry.URL = strings.TrimSpace(*body.URL)
	}
	if registry.Name == "" || registry.URL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name and url are required"})
		return
	}
	if body.AuthType != nil {
		trimmed := strings.TrimSpace(*body.AuthType)
		if trimmed == "" {
			registry.AuthType = models.RegistryAuthNone
		} else {
			registry.AuthType = trimmed
		}
	}
	if body.ScanProvider != nil {
		trimmed := strings.TrimSpace(*body.ScanProvider)
		if trimmed == "" {
			registry.ScanProvider = models.ScanProviderTrivy
		} else {
			registry.ScanProvider = trimmed
		}
	}
	if err := scanner.ValidateRegistryProviderSelection(registry.ScanProvider); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.Username != nil {
		registry.Username = strings.TrimSpace(*body.Username)
	}
	if body.XrayURL != nil {
		registry.XrayURL = strings.TrimSpace(*body.XrayURL)
	}
	if body.XrayArtifactoryID != nil {
		registry.XrayArtifactoryID = strings.TrimSpace(*body.XrayArtifactoryID)
	}
	if registry.ScanProvider == models.ScanProviderArtifactoryXray {
		if registry.XrayArtifactoryID == "" {
			registry.XrayArtifactoryID = "default"
		}
	} else {
		registry.XrayURL = ""
		registry.XrayArtifactoryID = "default"
	}
	if body.Password != nil {
		trimmed := strings.TrimSpace(*body.Password)
		if trimmed == "" {
			registry.Password = ""
		} else {
			key := crypto.KeyFromString(config.Config.Encryption.Key)
			enc, err := crypto.Encrypt(key, trimmed)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encrypt credentials"})
				return
			}
			registry.Password = enc
		}
	}

	registry.UpdatedAt = time.Now()
	if _, err := db.NewUpdate().Model(registry).
		Column("name", "url", "xray_url", "xray_artifactory_id", "auth_type", "scan_provider", "username", "password", "updated_at").
		Where("id = ? AND owner_type = ?", id, models.OwnerTypeSystem).
		Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update global registry"})
		return
	}

	registry.Password = ""
	c.JSON(http.StatusOK, registry)
}

// DeleteGlobalRegistry removes a system registry.
func DeleteGlobalRegistry(c *gin.Context, db *bun.DB) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry ID"})
		return
	}
	if _, err := db.NewDelete().Model((*models.Registry)(nil)).
		Where("id = ? AND owner_type = ?", id, models.OwnerTypeSystem).
		Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete registry"})
		return
	}
	c.Status(http.StatusNoContent)
}

// SetDefaultRegistry marks a system registry as the default (clears any previous default).
func SetDefaultRegistry(c *gin.Context, db *bun.DB) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry ID"})
		return
	}

	// Wrap in a transaction: clear existing default then set new one.
	if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().Model((*models.Registry)(nil)).
			Set("is_default = false, updated_at = now()").
			Where("is_default = true").
			Exec(ctx); err != nil {
			return err
		}
		if _, err := tx.NewUpdate().Model((*models.Registry)(nil)).
			Set("is_default = true, updated_at = now()").
			Where("id = ? AND owner_type = ?", id, models.OwnerTypeSystem).
			Exec(ctx); err != nil {
			return err
		}
		return nil
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to set default registry"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"id": id, "is_default": true})
}

// UnsetDefaultRegistry clears the default flag from a registry.
func UnsetDefaultRegistry(c *gin.Context, db *bun.DB) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry ID"})
		return
	}
	if _, err := db.NewUpdate().Model((*models.Registry)(nil)).
		Set("is_default = false, updated_at = now()").
		Where("id = ? AND owner_type = ?", id, models.OwnerTypeSystem).
		Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to unset default registry"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "is_default": false})
}

// getUserIDFromContext extracts the user UUID from the gin context (set by auth middleware).
func getUserIDFromContext(c *gin.Context) (uuid.UUID, error) {
	raw, exists := c.Get("userID")
	if !exists {
		return uuid.Nil, nil
	}
	switch v := raw.(type) {
	case uuid.UUID:
		return v, nil
	case string:
		return uuid.Parse(v)
	}
	return uuid.Nil, nil
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
