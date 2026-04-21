package admins

import (
	"context"
	"net/http"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/crypto"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

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
		body.ScanProvider = "trivy"
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
		enc, err := crypto.Encrypt(key, body.Password)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encrypt credentials"})
			return
		}
		encryptedPassword = enc
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
