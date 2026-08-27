package registries

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"justscan-backend/config"
	"justscan-backend/functions/authz"
	"justscan-backend/functions/resourceownership"
	"justscan-backend/pkg/crypto"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type workspaceRegistryPreference struct {
	WorkspaceKey         string     `bun:"workspace_key" json:"-"`
	DefaultRegistryID    *uuid.UUID `bun:"default_registry_id" json:"default_registry_id,omitempty"`
	HideSystemRegistries bool       `bun:"hide_system_registries" json:"hide_system_registries"`
}

type hiddenSystemRegistry struct {
	bun.BaseModel `bun:"table:workspace_hidden_system_registries"`
	RegistryID    uuid.UUID `bun:"registry_id"`
}

func registryWorkspaceKey(c *gin.Context, db *bun.DB, userID uuid.UUID, requireWrite bool) (string, bool) {
	scope := c.Query("scope")
	if scope == "" || scope == "personal" {
		return "personal:" + userID.String(), true
	}
	orgID, err := uuid.Parse(scope)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid workspace scope"})
		return "", false
	}
	minimumRole := models.OrgRoleViewer
	if requireWrite {
		minimumRole = models.OrgRoleEditor
	}
	if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, minimumRole); !ok {
		return "", false
	}
	return "org:" + orgID.String(), true
}

func loadWorkspaceRegistryPreference(ctx context.Context, db *bun.DB, workspaceKey string) (workspaceRegistryPreference, error) {
	pref := workspaceRegistryPreference{WorkspaceKey: workspaceKey}
	err := db.NewSelect().Model(&pref).Where("workspace_key = ?", workspaceKey).Scan(ctx)
	if err != nil && err != sql.ErrNoRows {
		return pref, err
	}
	return pref, nil
}

func ListRegistries(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		workspaceKey, ok := registryWorkspaceKey(c, db, userID, false)
		if !ok {
			return
		}
		preference, err := loadWorkspaceRegistryPreference(c.Request.Context(), db, workspaceKey)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load registry workspace preferences"})
			return
		}
		accessibleOrgIDs, err := authz.ListAccessibleOrgIDs(c.Request.Context(), db, userID, isAdmin)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve organization access"})
			return
		}

		var registries []models.Registry
		query := db.NewSelect().Model(&registries).
			Column("id", "name", "url", "xray_url", "xray_artifactory_id", "xray_repository", "xray_mode", "auth_type", "scan_provider", "username", "created_by_id", "owner_type", "owner_user_id", "owner_org_id", "created_at", "updated_at", "health_status", "health_message", "last_health_check_at").
			OrderExpr("name ASC")
		query = authz.ApplyOwnershipVisibility(query, "", "created_by_id", "owner_user_id", "owner_org_id", "org_registries", "registry_id", userID, isAdmin, accessibleOrgIDs)
		query = authz.ApplyWorkspaceScope(c, query, "", "owner_user_id", "owner_org_id", "org_registries", "registry_id", userID)
		var hiddenRows []hiddenSystemRegistry
		if err := db.NewSelect().Model(&hiddenRows).Where("workspace_key = ?", workspaceKey).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load hidden system registries"})
			return
		}
		hiddenIDs := make([]uuid.UUID, 0, len(hiddenRows))
		for _, row := range hiddenRows {
			hiddenIDs = append(hiddenIDs, row.RegistryID)
		}
		if c.Query("include_hidden_system") == "true" || len(hiddenIDs) == 0 {
			query = query.WhereOr("owner_type = ?", models.OwnerTypeSystem)
		} else {
			query = query.WhereOr("owner_type = ? AND id NOT IN (?)", models.OwnerTypeSystem, bun.In(hiddenIDs))
		}
		if err := query.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list registries"})
			return
		}
		for index := range registries {
			registries[index].IsDefault = preference.DefaultRegistryID != nil && registries[index].ID == *preference.DefaultRegistryID
		}
		c.JSON(http.StatusOK, gin.H{"data": registries, "capabilities": scanner.ScannerCapabilities(), "workspace_registry_preferences": preference, "hidden_system_registry_ids": hiddenIDs})
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
			XrayRepository    string `json:"xray_repository"`
			XrayMode          string `json:"xray_mode" binding:"omitempty,oneof=full limited"`
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
		body.XrayMode = models.NormalizeXrayMode(body.XrayMode)
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
			XrayRepository:    strings.Trim(strings.TrimSpace(body.XrayRepository), "/"),
			XrayMode:          body.XrayMode,
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
			XrayRepository    string `json:"xray_repository"`
			XrayMode          string `json:"xray_mode" binding:"omitempty,oneof=full limited"`
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
		if body.XrayRepository != "" || registry.ScanProvider == models.ScanProviderArtifactoryXray {
			registry.XrayRepository = strings.Trim(strings.TrimSpace(body.XrayRepository), "/")
		}
		if body.AuthType != "" {
			registry.AuthType = body.AuthType
		}
		if body.ScanProvider != "" {
			registry.ScanProvider = body.ScanProvider
		}
		if body.XrayMode != "" {
			registry.XrayMode = models.NormalizeXrayMode(body.XrayMode)
		}
		if err := scanner.ValidateRegistryProviderSelection(registry.ScanProvider); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if registry.ScanProvider != models.ScanProviderArtifactoryXray {
			registry.XrayURL = ""
			registry.XrayArtifactoryID = "default"
			registry.XrayRepository = ""
			registry.XrayMode = models.XrayModeLimited
		}
		registry.XrayMode = models.NormalizeXrayMode(registry.XrayMode)
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
			Column("name", "url", "xray_url", "xray_artifactory_id", "xray_repository", "xray_mode", "auth_type", "scan_provider", "username", "password", "updated_at").
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

func TransferRegistryOwnership(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		registryID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry ID"})
			return
		}
		registry := &models.Registry{}
		if err := db.NewSelect().Model(registry).Where("id = ?", registryID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "registry not found"})
			return
		}
		if _, ok := resourceownership.TransferOrgOwnedResource(c, db, resourceownership.TransferParams{
			ResourceID: registry.ID, OwnerType: registry.OwnerType, OwnerOrgID: registry.OwnerOrgID,
			ResourceTable: "registries", LinkTable: "org_registries", LinkResourceColumn: "registry_id",
			ResourceName: "registry", HasUpdatedAt: true,
		}); !ok {
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "ownership transferred"})
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

// GetDefaultRegistry returns the active workspace's preferred accessible registry.
func GetDefaultRegistry(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		workspaceKey, ok := registryWorkspaceKey(c, db, userID, false)
		if !ok {
			return
		}
		preference, err := loadWorkspaceRegistryPreference(c.Request.Context(), db, workspaceKey)
		if err != nil || preference.DefaultRegistryID == nil {
			c.JSON(http.StatusNoContent, nil)
			return
		}
		var registry models.Registry
		err = db.NewSelect().Model(&registry).Where("id = ?", *preference.DefaultRegistryID).Scan(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusNoContent, nil)
			return
		}
		if _, _, _, ok := authz.LoadAccessibleRegistry(c, db, registry.ID); !ok {
			return
		}
		registry.Password = ""
		c.JSON(http.StatusOK, registry)
	}
}

func SetUserDefaultRegistry(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		registryID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry ID"})
			return
		}
		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		workspaceKey, ok := registryWorkspaceKey(c, db, userID, true)
		if !ok {
			return
		}
		_, _, _, ok = authz.LoadAccessibleRegistry(c, db, registryID)
		if !ok {
			return
		}
		if _, err := db.NewRaw(`INSERT INTO workspace_registry_preferences (workspace_key, default_registry_id, updated_at) VALUES (?, ?, now()) ON CONFLICT (workspace_key) DO UPDATE SET default_registry_id = EXCLUDED.default_registry_id, updated_at = now()`, workspaceKey, registryID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to set default registry"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"id": registryID, "is_default": true})
	}
}

func ClearUserDefaultRegistry(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		workspaceKey, ok := registryWorkspaceKey(c, db, userID, true)
		if !ok {
			return
		}
		if _, err := db.NewRaw(`INSERT INTO workspace_registry_preferences (workspace_key, default_registry_id, updated_at) VALUES (?, NULL, now()) ON CONFLICT (workspace_key) DO UPDATE SET default_registry_id = NULL, updated_at = now()`, workspaceKey).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear default registry"})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// SetSystemRegistryVisibility hides or shows one centrally managed registry
// for every member of the active workspace.
func SetSystemRegistryVisibility(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		registryID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry ID"})
			return
		}
		var body struct {
			Hidden bool `json:"hidden"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		workspaceKey, ok := registryWorkspaceKey(c, db, userID, true)
		if !ok {
			return
		}
		registry := new(models.Registry)
		if err := db.NewSelect().Model(registry).Where("id = ? AND owner_type = ?", registryID, models.OwnerTypeSystem).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "system registry not found"})
			return
		}
		if body.Hidden {
			if _, err := db.NewRaw(`INSERT INTO workspace_hidden_system_registries (workspace_key, registry_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, workspaceKey, registryID).Exec(c.Request.Context()); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hide system registry"})
				return
			}
			if _, err := db.NewUpdate().Table("workspace_registry_preferences").Set("default_registry_id = NULL, updated_at = now()").Where("workspace_key = ? AND default_registry_id = ?", workspaceKey, registryID).Exec(c.Request.Context()); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear hidden default registry"})
				return
			}
		} else if _, err := db.NewDelete().Table("workspace_hidden_system_registries").Where("workspace_key = ? AND registry_id = ?", workspaceKey, registryID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to show system registry"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"id": registryID, "hidden": body.Hidden})
	}
}
