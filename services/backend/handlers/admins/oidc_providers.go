package admins

import (
	"net/http"
	"time"

	"justscan-backend/functions/auth"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
	"github.com/uptrace/bun"
)

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
	// Hydrate org names.
	for i := range mappings {
		var org models.Org
		if err := db.NewSelect().Model(&org).Where("id = ?", mappings[i].OrgID).Scan(c.Request.Context()); err == nil {
			mappings[i].OrgName = org.Name
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": mappings})
}

// CreateGroupMapping adds a new group→org mapping for a provider.
func CreateGroupMapping(c *gin.Context, db *bun.DB) {
	providerName := c.Param("name")
	var body struct {
		OIDCGroup      string `json:"oidc_group" binding:"required"`
		OrgID          string `json:"org_id" binding:"required"`
		Role           string `json:"role"`
		AutoCreateOrg  bool   `json:"auto_create_org"`
		RemoveOnUnsync *bool  `json:"remove_on_unsync"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.Role == "" {
		body.Role = "viewer"
	}
	removeOnUnsync := true
	if body.RemoveOnUnsync != nil {
		removeOnUnsync = *body.RemoveOnUnsync
	}
	mapping := &models.OIDCGroupOrgMapping{
		ProviderName:   providerName,
		OIDCGroup:      body.OIDCGroup,
		OrgID:          body.OrgID,
		Role:           body.Role,
		AutoCreateOrg:  body.AutoCreateOrg,
		RemoveOnUnsync: removeOnUnsync,
		CreatedAt:      time.Now(),
	}
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
