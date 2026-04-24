package admins

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"justscan-backend/functions/auth"
	authhandlers "justscan-backend/handlers/auths"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/uptrace/bun"
)

var allowedOIDCClaimTypes = map[string]struct{}{
	"group": {},
	"role":  {},
}

var allowedOIDCMatchTypes = map[string]struct{}{
	"exact":  {},
	"prefix": {},
}

var allowedOIDCProvisioningModes = map[string]struct{}{
	"existing_org": {},
	"create_org":   {},
}

var allowedOIDCEffects = map[string]struct{}{
	"allow":   {},
	"exclude": {},
}

var allowedOIDCTargetTypes = map[string]struct{}{
	"org_id":        {},
	"rendered_name": {},
}

var allowedOIDCMappingRoles = map[string]struct{}{
	"viewer": {},
	"editor": {},
	"admin":  {},
}

type oidcMappingRequest struct {
	ClaimType           string  `json:"claim_type"`
	Effect              string  `json:"effect"`
	MatchType           string  `json:"match_type"`
	MatchValue          string  `json:"match_value"`
	OIDCGroup           string  `json:"oidc_group"`
	ProvisioningMode    string  `json:"provisioning_mode"`
	OrgID               *string `json:"org_id"`
	OrgNameTemplate     string  `json:"org_name_template"`
	Role                string  `json:"role"`
	RecreateMissingOrg  bool    `json:"recreate_missing_org"`
	AutoCreateOrgLegacy bool    `json:"auto_create_org"`
	RemoveOnUnsync      *bool   `json:"remove_on_unsync"`
}

type oidcRoleOverrideRequest struct {
	ClaimType       string  `json:"claim_type"`
	MatchType       string  `json:"match_type"`
	MatchValue      string  `json:"match_value"`
	TargetType      string  `json:"target_type"`
	OrgID           *string `json:"org_id"`
	OrgNameTemplate string  `json:"org_name_template"`
	Role            string  `json:"role"`
}

type oidcClaimSyncPreviewRequest struct {
	Groups []string `json:"groups"`
	Roles  []string `json:"roles"`
}

// ListOIDCProviders returns all configured OIDC providers (admin).
func ListOIDCProviders(c *gin.Context, db *bun.DB) {
	var providers []models.OIDCProvider
	if err := db.NewSelect().Model(&providers).OrderExpr("sort_order ASC, name ASC").Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list providers"})
		return
	}
	// Strip secrets from response.
	for i := range providers {
		providers[i].ClientSecret = ""
	}
	c.JSON(http.StatusOK, gin.H{"data": providers})
}

// CreateOIDCProvider creates a new OIDC provider configuration.
func CreateOIDCProvider(c *gin.Context, db *bun.DB) {
	var body struct {
		Name             string   `json:"name" binding:"required"`
		DisplayName      string   `json:"display_name" binding:"required"`
		ButtonColor      string   `json:"button_color"`
		IssuerURL        string   `json:"issuer_url" binding:"required"`
		ClientID         string   `json:"client_id" binding:"required"`
		ClientSecret     string   `json:"client_secret" binding:"required"`
		RedirectURI      string   `json:"redirect_uri" binding:"required"`
		Scopes           []string `json:"scopes"`
		AdminGroups      []string `json:"admin_groups"`
		AdminRoles       []string `json:"admin_roles"`
		IncludedGroups   []string `json:"included_groups"`
		ExcludedGroups   []string `json:"excluded_groups"`
		IncludedOrgNames []string `json:"included_org_names"`
		ExcludedOrgNames []string `json:"excluded_org_names"`
		GroupsClaim      string   `json:"groups_claim"`
		RolesClaim       string   `json:"roles_claim"`
		Enabled          *bool    `json:"enabled"`
		SortOrder        int      `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.GroupsClaim == "" {
		body.GroupsClaim = "groups"
	}
	if body.RolesClaim == "" {
		body.RolesClaim = "roles"
	}
	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	now := time.Now()
	provider := &models.OIDCProvider{
		Name:             body.Name,
		DisplayName:      body.DisplayName,
		ButtonColor:      body.ButtonColor,
		IssuerURL:        body.IssuerURL,
		ClientID:         body.ClientID,
		ClientSecret:     body.ClientSecret,
		RedirectURI:      body.RedirectURI,
		Scopes:           pq.StringArray(body.Scopes),
		AdminGroups:      pq.StringArray(body.AdminGroups),
		AdminRoles:       pq.StringArray(body.AdminRoles),
		IncludedGroups:   pq.StringArray(normalizeStringList(body.IncludedGroups)),
		ExcludedGroups:   pq.StringArray(normalizeStringList(body.ExcludedGroups)),
		IncludedOrgNames: pq.StringArray(normalizeStringList(body.IncludedOrgNames)),
		ExcludedOrgNames: pq.StringArray(normalizeStringList(body.ExcludedOrgNames)),
		GroupsClaim:      body.GroupsClaim,
		RolesClaim:       body.RolesClaim,
		Enabled:          enabled,
		SortOrder:        body.SortOrder,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if _, err := db.NewInsert().Model(provider).Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create provider"})
		return
	}
	provider.ClientSecret = ""
	c.JSON(http.StatusCreated, provider)
}

// UpdateOIDCProvider updates a OIDC provider configuration.
func UpdateOIDCProvider(c *gin.Context, db *bun.DB) {
	name := c.Param("name")
	var body struct {
		DisplayName      string   `json:"display_name"`
		ButtonColor      string   `json:"button_color"`
		IssuerURL        string   `json:"issuer_url"`
		ClientID         string   `json:"client_id"`
		ClientSecret     string   `json:"client_secret"` // empty = keep existing
		RedirectURI      string   `json:"redirect_uri"`
		Scopes           []string `json:"scopes"`
		AdminGroups      []string `json:"admin_groups"`
		AdminRoles       []string `json:"admin_roles"`
		IncludedGroups   []string `json:"included_groups"`
		ExcludedGroups   []string `json:"excluded_groups"`
		IncludedOrgNames []string `json:"included_org_names"`
		ExcludedOrgNames []string `json:"excluded_org_names"`
		GroupsClaim      string   `json:"groups_claim"`
		RolesClaim       string   `json:"roles_claim"`
		Enabled          *bool    `json:"enabled"`
		SortOrder        *int     `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var existing models.OIDCProvider
	if err := db.NewSelect().Model(&existing).Where("name = ?", name).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "provider not found"})
		return
	}

	if body.DisplayName != "" {
		existing.DisplayName = body.DisplayName
	}
	existing.ButtonColor = body.ButtonColor
	if body.IssuerURL != "" {
		existing.IssuerURL = body.IssuerURL
	}
	if body.ClientID != "" {
		existing.ClientID = body.ClientID
	}
	if body.ClientSecret != "" {
		existing.ClientSecret = body.ClientSecret
	}
	if body.RedirectURI != "" {
		existing.RedirectURI = body.RedirectURI
	}
	if body.Scopes != nil {
		existing.Scopes = pq.StringArray(body.Scopes)
	}
	if body.AdminGroups != nil {
		existing.AdminGroups = pq.StringArray(body.AdminGroups)
	}
	if body.AdminRoles != nil {
		existing.AdminRoles = pq.StringArray(body.AdminRoles)
	}
	if body.IncludedGroups != nil {
		existing.IncludedGroups = pq.StringArray(normalizeStringList(body.IncludedGroups))
	}
	if body.ExcludedGroups != nil {
		existing.ExcludedGroups = pq.StringArray(normalizeStringList(body.ExcludedGroups))
	}
	if body.IncludedOrgNames != nil {
		existing.IncludedOrgNames = pq.StringArray(normalizeStringList(body.IncludedOrgNames))
	}
	if body.ExcludedOrgNames != nil {
		existing.ExcludedOrgNames = pq.StringArray(normalizeStringList(body.ExcludedOrgNames))
	}
	if body.GroupsClaim != "" {
		existing.GroupsClaim = body.GroupsClaim
	}
	if body.RolesClaim != "" {
		existing.RolesClaim = body.RolesClaim
	}
	if body.Enabled != nil {
		existing.Enabled = *body.Enabled
	}
	if body.SortOrder != nil {
		existing.SortOrder = *body.SortOrder
	}
	existing.UpdatedAt = time.Now()

	if _, err := db.NewUpdate().Model(&existing).WherePK().Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update provider"})
		return
	}

	// Invalidate the cached provider so changes take effect immediately.
	auth.InvalidateProviderCache(name)

	existing.ClientSecret = ""
	c.JSON(http.StatusOK, existing)
}

// DeleteOIDCProvider removes an OIDC provider configuration.
func DeleteOIDCProvider(c *gin.Context, db *bun.DB) {
	name := c.Param("name")
	if _, err := db.NewDelete().Model((*models.OIDCProvider)(nil)).Where("name = ?", name).Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete provider"})
		return
	}
	auth.InvalidateProviderCache(name)
	c.Status(http.StatusNoContent)
}

// ListGroupMappings returns all group→org mappings for a provider.
func ListGroupMappings(c *gin.Context, db *bun.DB) {
	providerName := c.Param("name")
	var mappings []models.OIDCGroupOrgMapping
	if err := db.NewSelect().Model(&mappings).Where("provider_name = ?", providerName).OrderExpr("created_at ASC").Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list mappings"})
		return
	}
	// Hydrate org names for rules that reference a concrete org.
	for i := range mappings {
		if mappings[i].OrgID == nil {
			continue
		}
		var org models.Org
		if err := db.NewSelect().Model(&org).Where("id = ?", *mappings[i].OrgID).Scan(c.Request.Context()); err == nil {
			mappings[i].OrgName = org.Name
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": mappings})
}

// CreateGroupMapping adds a new explicit OIDC claim mapping rule for a provider.
func CreateGroupMapping(c *gin.Context, db *bun.DB) {
	providerName := c.Param("name")
	var body oidcMappingRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	mapping, err := buildOIDCMapping(c.Request.Context(), db, providerName, body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	removeOnUnsync := true
	if body.RemoveOnUnsync != nil {
		removeOnUnsync = *body.RemoveOnUnsync
	}
	mapping.RemoveOnUnsync = removeOnUnsync
	mapping.CreatedAt = time.Now()
	if _, err := db.NewInsert().Model(mapping).Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create mapping"})
		return
	}
	c.JSON(http.StatusCreated, mapping)
}

// UpdateGroupMapping updates an existing explicit OIDC claim mapping rule.
func UpdateGroupMapping(c *gin.Context, db *bun.DB) {
	providerName := c.Param("name")
	mappingID := c.Param("mappingID")

	var existing models.OIDCGroupOrgMapping
	if err := db.NewSelect().Model(&existing).
		Where("id = ?", mappingID).
		Where("provider_name = ?", providerName).
		Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "mapping not found"})
		return
	}

	var body oidcMappingRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	mapping, err := buildOIDCMapping(c.Request.Context(), db, providerName, body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	removeOnUnsync := existing.RemoveOnUnsync
	if body.RemoveOnUnsync != nil {
		removeOnUnsync = *body.RemoveOnUnsync
	}

	mapping.ID = existing.ID
	mapping.CreatedAt = existing.CreatedAt
	mapping.RemoveOnUnsync = removeOnUnsync

	if _, err := db.NewUpdate().Model(mapping).WherePK().Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update mapping"})
		return
	}

	if mapping.OrgID != nil {
		var org models.Org
		if err := db.NewSelect().Model(&org).Where("id = ?", *mapping.OrgID).Scan(c.Request.Context()); err == nil {
			mapping.OrgName = org.Name
		}
	}

	c.JSON(http.StatusOK, mapping)
}

// DeleteGroupMapping removes a group→org mapping.
func DeleteGroupMapping(c *gin.Context, db *bun.DB) {
	id := c.Param("mappingID")
	if _, err := db.NewDelete().Model((*models.OIDCGroupOrgMapping)(nil)).Where("id = ?", id).Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete mapping"})
		return
	}
	c.Status(http.StatusNoContent)
}

// PreviewClaimSync evaluates OIDC claim routing without mutating memberships.
func PreviewClaimSync(c *gin.Context, db *bun.DB) {
	providerName := c.Param("name")
	var body oidcClaimSyncPreviewRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	preview, err := authhandlers.EvaluateOIDCClaimSync(c.Request.Context(), db, providerName, normalizeStringList(body.Groups), normalizeStringList(body.Roles))
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": preview})
}

// ListRoleOverrides returns all provider-scoped OIDC role override rules.
func ListRoleOverrides(c *gin.Context, db *bun.DB) {
	providerName := c.Param("name")
	var overrides []models.OIDCOrgRoleOverride
	if err := db.NewSelect().Model(&overrides).Where("provider_name = ?", providerName).OrderExpr("created_at ASC").Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list role overrides"})
		return
	}
	for i := range overrides {
		if overrides[i].OrgID == nil {
			continue
		}
		var org models.Org
		if err := db.NewSelect().Model(&org).Where("id = ?", *overrides[i].OrgID).Scan(c.Request.Context()); err == nil {
			overrides[i].OrgName = org.Name
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": overrides})
}

// CreateRoleOverride adds a new provider-scoped role override rule.
func CreateRoleOverride(c *gin.Context, db *bun.DB) {
	providerName := c.Param("name")
	var body oidcRoleOverrideRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	override, err := buildOIDCRoleOverride(c.Request.Context(), db, providerName, body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	now := time.Now()
	override.CreatedAt = now
	override.UpdatedAt = now
	if _, err := db.NewInsert().Model(override).Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create role override"})
		return
	}
	c.JSON(http.StatusCreated, override)
}

// UpdateRoleOverride updates an existing provider-scoped role override rule.
func UpdateRoleOverride(c *gin.Context, db *bun.DB) {
	providerName := c.Param("name")
	overrideID := c.Param("overrideID")

	var existing models.OIDCOrgRoleOverride
	if err := db.NewSelect().Model(&existing).
		Where("id = ?", overrideID).
		Where("provider_name = ?", providerName).
		Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "role override not found"})
		return
	}

	var body oidcRoleOverrideRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	override, err := buildOIDCRoleOverride(c.Request.Context(), db, providerName, body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	override.ID = existing.ID
	override.CreatedAt = existing.CreatedAt
	override.UpdatedAt = time.Now()

	if _, err := db.NewUpdate().Model(override).WherePK().Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update role override"})
		return
	}

	if override.OrgID != nil {
		var org models.Org
		if err := db.NewSelect().Model(&org).Where("id = ?", *override.OrgID).Scan(c.Request.Context()); err == nil {
			override.OrgName = org.Name
		}
	}

	c.JSON(http.StatusOK, override)
}

// DeleteRoleOverride removes a provider-scoped role override rule.
func DeleteRoleOverride(c *gin.Context, db *bun.DB) {
	id := c.Param("overrideID")
	if _, err := db.NewDelete().Model((*models.OIDCOrgRoleOverride)(nil)).Where("id = ?", id).Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete role override"})
		return
	}
	c.Status(http.StatusNoContent)
}

func buildOIDCMapping(ctx context.Context, db *bun.DB, providerName string, body oidcMappingRequest) (*models.OIDCGroupOrgMapping, error) {
	claimType := strings.TrimSpace(body.ClaimType)
	if claimType == "" {
		claimType = "group"
	}
	if _, ok := allowedOIDCClaimTypes[claimType]; !ok {
		return nil, fmt.Errorf("invalid claim_type %q", claimType)
	}

	effect := strings.TrimSpace(body.Effect)
	if effect == "" {
		effect = "allow"
	}
	if _, ok := allowedOIDCEffects[effect]; !ok {
		return nil, fmt.Errorf("invalid effect %q", effect)
	}

	matchType := strings.TrimSpace(body.MatchType)
	if matchType == "" {
		matchType = "exact"
	}
	if _, ok := allowedOIDCMatchTypes[matchType]; !ok {
		return nil, fmt.Errorf("invalid match_type %q", matchType)
	}

	matchValue := strings.TrimSpace(body.MatchValue)
	if matchValue == "" {
		matchValue = strings.TrimSpace(body.OIDCGroup)
	}
	if matchValue == "" {
		return nil, fmt.Errorf("match_value is required")
	}
	if matchType == "prefix" && matchValue == "" {
		return nil, fmt.Errorf("prefix mappings require a non-empty match_value")
	}

	provisioningMode := strings.TrimSpace(body.ProvisioningMode)
	if provisioningMode == "" {
		provisioningMode = "existing_org"
	}
	if _, ok := allowedOIDCProvisioningModes[provisioningMode]; !ok {
		return nil, fmt.Errorf("invalid provisioning_mode %q", provisioningMode)
	}

	role := strings.TrimSpace(body.Role)
	if role == "" && provisioningMode == "create_org" {
		role = "admin"
	}
	if role == "" {
		role = "viewer"
	}
	if _, ok := allowedOIDCMappingRoles[role]; !ok {
		return nil, fmt.Errorf("invalid role %q", role)
	}

	recreateMissingOrg := body.RecreateMissingOrg || body.AutoCreateOrgLegacy
	orgNameTemplate := strings.TrimSpace(body.OrgNameTemplate)
	if matchType == "exact" && strings.Contains(orgNameTemplate, "{suffix}") {
		return nil, fmt.Errorf("{suffix} can only be used with prefix mappings")
	}

	var orgID *uuid.UUID
	if body.OrgID != nil && strings.TrimSpace(*body.OrgID) != "" {
		parsedOrgID, err := uuid.Parse(strings.TrimSpace(*body.OrgID))
		if err != nil {
			return nil, fmt.Errorf("invalid org_id")
		}
		orgID = &parsedOrgID
	}

	if effect == "exclude" {
		if body.OrgID != nil && strings.TrimSpace(*body.OrgID) != "" {
			return nil, fmt.Errorf("exclude mappings cannot set org_id")
		}
		if orgNameTemplate != "" {
			return nil, fmt.Errorf("exclude mappings cannot set org_name_template")
		}
		if strings.TrimSpace(body.Role) != "" && role != "viewer" {
			return nil, fmt.Errorf("exclude mappings cannot set role")
		}
		orgID = nil
		role = "viewer"
		provisioningMode = "existing_org"
		recreateMissingOrg = false
		orgNameTemplate = ""
	}

	if provisioningMode == "existing_org" {
		if effect == "allow" && orgID == nil {
			return nil, fmt.Errorf("existing_org mappings require org_id")
		}
		if effect == "allow" {
			orgExists, err := db.NewSelect().Model((*models.Org)(nil)).Where("id = ?", *orgID).Exists(ctx)
			if err != nil {
				return nil, fmt.Errorf("failed to validate org_id: %w", err)
			}
			if !orgExists && !recreateMissingOrg {
				return nil, fmt.Errorf("organization not found")
			}
			if recreateMissingOrg && orgNameTemplate == "" {
				orgNameTemplate = "{claim}"
			}
		}
	}

	if provisioningMode == "create_org" {
		if effect == "exclude" {
			return nil, fmt.Errorf("exclude mappings cannot use create_org provisioning")
		}
		orgID = nil
		if orgNameTemplate == "" {
			return nil, fmt.Errorf("create_org mappings require org_name_template")
		}
		recreateMissingOrg = false
	}

	return &models.OIDCGroupOrgMapping{
		ProviderName:       providerName,
		Effect:             effect,
		ClaimType:          claimType,
		MatchType:          matchType,
		MatchValue:         matchValue,
		OrgID:              orgID,
		Role:               role,
		ProvisioningMode:   provisioningMode,
		OrgNameTemplate:    orgNameTemplate,
		RecreateMissingOrg: recreateMissingOrg,
	}, nil
}

func buildOIDCRoleOverride(ctx context.Context, db *bun.DB, providerName string, body oidcRoleOverrideRequest) (*models.OIDCOrgRoleOverride, error) {
	claimType := strings.TrimSpace(body.ClaimType)
	if claimType == "" {
		claimType = "group"
	}
	if _, ok := allowedOIDCClaimTypes[claimType]; !ok {
		return nil, fmt.Errorf("invalid claim_type %q", claimType)
	}

	matchType := strings.TrimSpace(body.MatchType)
	if matchType == "" {
		matchType = "exact"
	}
	if _, ok := allowedOIDCMatchTypes[matchType]; !ok {
		return nil, fmt.Errorf("invalid match_type %q", matchType)
	}

	matchValue := strings.TrimSpace(body.MatchValue)
	if matchValue == "" {
		return nil, fmt.Errorf("match_value is required")
	}

	targetType := strings.TrimSpace(body.TargetType)
	if targetType == "" {
		targetType = "org_id"
	}
	if _, ok := allowedOIDCTargetTypes[targetType]; !ok {
		return nil, fmt.Errorf("invalid target_type %q", targetType)
	}

	role := strings.TrimSpace(body.Role)
	if role == "" || role == models.OrgRoleOwner {
		return nil, fmt.Errorf("role overrides require viewer, editor, or admin")
	}
	if _, ok := allowedOIDCMappingRoles[role]; !ok {
		return nil, fmt.Errorf("invalid role %q", role)
	}

	orgNameTemplate := strings.TrimSpace(body.OrgNameTemplate)
	if matchType != "prefix" && strings.Contains(orgNameTemplate, "{suffix}") {
		return nil, fmt.Errorf("{suffix} can only be used with prefix mappings")
	}

	var orgID *uuid.UUID
	if body.OrgID != nil && strings.TrimSpace(*body.OrgID) != "" {
		parsedOrgID, err := uuid.Parse(strings.TrimSpace(*body.OrgID))
		if err != nil {
			return nil, fmt.Errorf("invalid org_id")
		}
		orgID = &parsedOrgID
	}

	switch targetType {
	case "org_id":
		if orgID == nil {
			return nil, fmt.Errorf("org_id target overrides require org_id")
		}
		orgExists, err := db.NewSelect().Model((*models.Org)(nil)).Where("id = ?", *orgID).Exists(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to validate org_id: %w", err)
		}
		if !orgExists {
			return nil, fmt.Errorf("organization not found")
		}
		orgNameTemplate = ""
	case "rendered_name":
		if orgNameTemplate == "" {
			return nil, fmt.Errorf("rendered_name target overrides require org_name_template")
		}
		orgID = nil
	}

	return &models.OIDCOrgRoleOverride{
		ProviderName:    providerName,
		ClaimType:       claimType,
		MatchType:       matchType,
		MatchValue:      matchValue,
		TargetType:      targetType,
		OrgID:           orgID,
		OrgNameTemplate: orgNameTemplate,
		Role:            role,
	}, nil
}

func normalizeStringList(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(value)
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	return result
}
