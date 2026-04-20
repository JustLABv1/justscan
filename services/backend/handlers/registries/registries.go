package registries

import (
	"context"
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
		accessibleOrgIDs, err := authz.ListAccessibleOrgIDs(c.Request.Context(), db, userID, isAdmin)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve organization access"})
			return
		}

		var registries []models.Registry
		query := db.NewSelect().Model(&registries).
			Column("id", "name", "url", "xray_url", "xray_artifactory_id", "auth_type", "scan_provider", "username", "created_by_id", "owner_type", "owner_user_id", "owner_org_id", "created_at", "updated_at", "health_status", "health_message", "last_health_check_at").
			OrderExpr("name ASC")
		query = authz.ApplyOwnershipVisibility(query, "", "created_by_id", "owner_user_id", "owner_org_id", "org_registries", "registry_id", userID, isAdmin, accessibleOrgIDs)
		query = authz.ApplyWorkspaceScope(c, query, "", "owner_user_id", "owner_org_id", "org_registries", "registry_id", userID)
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
			OrgID             string `json:"org_id"`
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
		var ownerOrgID *uuid.UUID
		if body.OrgID != "" {
			parsedOrgID, err := uuid.Parse(body.OrgID)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
				return
			}
			if _, _, _, _, ok := authz.RequireOrgRole(c, db, parsedOrgID, models.OrgRoleEditor); !ok {
				return
			}
			ownerOrgID = &parsedOrgID
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
			OwnerType:         models.OwnerTypeUser,
			OwnerUserID:       &userID,
			CreatedAt:         time.Now(),
			UpdatedAt:         time.Now(),
		}
		if ownerOrgID != nil {
			registry.OwnerType = models.OwnerTypeOrg
			registry.OwnerUserID = nil
			registry.OwnerOrgID = ownerOrgID
		}
		if _, err := db.NewInsert().Model(registry).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create registry"})
			return
		}
		if ownerOrgID != nil {
			if _, err := db.NewInsert().Model(&models.OrgRegistry{OrgID: *ownerOrgID, RegistryID: registry.ID}).On("CONFLICT DO NOTHING").Exec(c.Request.Context()); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to share registry with organization"})
				return
			}
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

type registryShare struct {
	OrgID          uuid.UUID `bun:"org_id" json:"org_id"`
	OrgName        string    `bun:"org_name" json:"org_name"`
	OrgDescription string    `bun:"org_description" json:"org_description"`
	IsOwner        bool      `bun:"-" json:"is_owner"`
}

func ListRegistryShares(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		registry, _, _, ok := loadRegistryForShareManagement(c, db)
		if !ok {
			return
		}

		var shares []registryShare
		if err := db.NewSelect().
			TableExpr("org_registries AS org_registry").
			ColumnExpr("o.id AS org_id").
			ColumnExpr("o.name AS org_name").
			ColumnExpr("o.description AS org_description").
			Join("JOIN orgs AS o ON o.id = org_registry.org_id").
			Where("org_registry.registry_id = ?", registry.ID).
			OrderExpr("o.name ASC").
			Scan(c.Request.Context(), &shares); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list registry shares"})
			return
		}

		for index := range shares {
			shares[index].IsOwner = registry.OwnerOrgID != nil && shares[index].OrgID == *registry.OwnerOrgID
		}

		c.JSON(http.StatusOK, gin.H{"data": shares})
	}
}

func ShareRegistry(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		registry, _, isAdmin, ok := loadRegistryForShareManagement(c, db)
		if !ok {
			return
		}

		var body struct {
			OrgID string `json:"org_id" binding:"required"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		targetOrgID, err := uuid.Parse(body.OrgID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
			return
		}
		if registry.OwnerOrgID != nil && *registry.OwnerOrgID == targetOrgID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "resource is already owned by that organization"})
			return
		}
		if !isAdmin {
			if _, _, _, _, ok := authz.RequireOrgRole(c, db, targetOrgID, models.OrgRoleEditor); !ok {
				return
			}
		}

		if _, err := db.NewInsert().Model(&models.OrgRegistry{OrgID: targetOrgID, RegistryID: registry.ID}).On("CONFLICT DO NOTHING").Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to share registry"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"result": "shared"})
	}
}

func UnshareRegistry(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		registry, _, _, ok := loadRegistryForShareManagement(c, db)
		if !ok {
			return
		}

		targetOrgID, err := uuid.Parse(c.Param("orgId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
			return
		}
		if registry.OwnerOrgID != nil && *registry.OwnerOrgID == targetOrgID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot remove the owner organization"})
			return
		}

		if _, err := db.NewDelete().Model((*models.OrgRegistry)(nil)).
			Where("org_id = ?", targetOrgID).
			Where("registry_id = ?", registry.ID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke registry share"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "unshared"})
	}
}

func loadRegistryForShareManagement(c *gin.Context, db *bun.DB) (*models.Registry, uuid.UUID, bool, bool) {
	registryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry ID"})
		return nil, uuid.Nil, false, false
	}

	userID, isAdmin, ok := authz.RequireRequestUser(c, db)
	if !ok {
		return nil, uuid.Nil, false, false
	}

	registry := &models.Registry{}
	if err := db.NewSelect().Model(registry).Where("id = ?", registryID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "registry not found"})
		return nil, uuid.Nil, false, false
	}

	if !canManageRegistryShares(c.Request.Context(), db, registry, userID, isAdmin) {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return nil, uuid.Nil, false, false
	}

	return registry, userID, isAdmin, true
}

func canManageRegistryShares(ctx context.Context, db *bun.DB, registry *models.Registry, userID uuid.UUID, isAdmin bool) bool {
	if registry == nil {
		return false
	}
	if isAdmin || registry.CreatedByID == userID {
		return true
	}
	if registry.OwnerUserID != nil && *registry.OwnerUserID == userID {
		return true
	}
	if registry.OwnerOrgID == nil {
		return false
	}
	roles, err := authz.LoadUserOrgRoles(ctx, db, userID)
	if err != nil {
		return false
	}
	return authz.HasOrgRoleAtLeast(roles, *registry.OwnerOrgID, models.OrgRoleEditor)
}
