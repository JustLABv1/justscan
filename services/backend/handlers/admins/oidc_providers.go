package admins

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"justscan-backend/functions/auth"
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

var allowedOIDCMappingRoles = map[string]struct{}{
	"viewer": {},
	"editor": {},
	"admin":  {},
}

type oidcMappingRequest struct {
	ClaimType           string  `json:"claim_type"`
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
		Name         string   `json:"name" binding:"required"`
		DisplayName  string   `json:"display_name" binding:"required"`
		ButtonColor  string   `json:"button_color"`
		IssuerURL    string   `json:"issuer_url" binding:"required"`
		ClientID     string   `json:"client_id" binding:"required"`
		ClientSecret string   `json:"client_secret" binding:"required"`
		RedirectURI  string   `json:"redirect_uri" binding:"required"`
		Scopes       []string `json:"scopes"`
		AdminGroups  []string `json:"admin_groups"`
		AdminRoles   []string `json:"admin_roles"`
		GroupsClaim  string   `json:"groups_claim"`
		RolesClaim   string   `json:"roles_claim"`
		Enabled      *bool    `json:"enabled"`
		SortOrder    int      `json:"sort_order"`
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
		Name:         body.Name,
		DisplayName:  body.DisplayName,
		ButtonColor:  body.ButtonColor,
		IssuerURL:    body.IssuerURL,
		ClientID:     body.ClientID,
		ClientSecret: body.ClientSecret,
		RedirectURI:  body.RedirectURI,
		Scopes:       pq.StringArray(body.Scopes),
		AdminGroups:  pq.StringArray(body.AdminGroups),
		AdminRoles:   pq.StringArray(body.AdminRoles),
		GroupsClaim:  body.GroupsClaim,
		RolesClaim:   body.RolesClaim,
		Enabled:      enabled,
		SortOrder:    body.SortOrder,
		CreatedAt:    now,
		UpdatedAt:    now,
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
		DisplayName  string   `json:"display_name"`
		ButtonColor  string   `json:"button_color"`
		IssuerURL    string   `json:"issuer_url"`
		ClientID     string   `json:"client_id"`
		ClientSecret string   `json:"client_secret"` // empty = keep existing
		RedirectURI  string   `json:"redirect_uri"`
		Scopes       []string `json:"scopes"`
		AdminGroups  []string `json:"admin_groups"`
		AdminRoles   []string `json:"admin_roles"`
		GroupsClaim  string   `json:"groups_claim"`
		RolesClaim   string   `json:"roles_claim"`
		Enabled      *bool    `json:"enabled"`
		SortOrder    *int     `json:"sort_order"`
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

// DeleteGroupMapping removes a group→org mapping.
func DeleteGroupMapping(c *gin.Context, db *bun.DB) {
	id := c.Param("mappingID")
	if _, err := db.NewDelete().Model((*models.OIDCGroupOrgMapping)(nil)).Where("id = ?", id).Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete mapping"})
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

	if provisioningMode == "existing_org" {
		if orgID == nil {
			return nil, fmt.Errorf("existing_org mappings require org_id")
		}
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

	if provisioningMode == "create_org" {
		orgID = nil
		if orgNameTemplate == "" {
			return nil, fmt.Errorf("create_org mappings require org_name_template")
		}
		recreateMissingOrg = false
	}

	return &models.OIDCGroupOrgMapping{
		ProviderName:       providerName,
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
