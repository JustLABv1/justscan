package helmregistrycredentials

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"strings"
	"time"

	"justscan-backend/config"
	"justscan-backend/functions/authz"
	"justscan-backend/functions/resourceownership"
	"justscan-backend/pkg/crypto"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type request struct {
	Name     string `json:"name"`
	URL      string `json:"url"`
	Protocol string `json:"protocol"`
	AuthType string `json:"auth_type"`
	Username string `json:"username"`
	Secret   string `json:"secret"`
	OrgID    string `json:"org_id"`
}

func List(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, admin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		orgIDs, err := authz.ListAccessibleOrgIDs(c.Request.Context(), db, userID, admin)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to resolve organization access"})
			return
		}
		var items []models.HelmRegistryCredential
		q := db.NewSelect().Model(&items).Column("id", "name", "url", "protocol", "auth_type", "username", "encrypted_secret", "created_by_id", "owner_type", "owner_user_id", "owner_org_id", "created_at", "updated_at", "health_status", "health_message", "last_health_check_at").OrderExpr("name ASC")
		q = authz.ApplyOwnershipVisibility(q, "", "created_by_id", "owner_user_id", "owner_org_id", "org_helm_registry_credentials", "helm_registry_credential_id", userID, admin, orgIDs)
		q = authz.ApplyWorkspaceScope(c, q, "", "owner_user_id", "owner_org_id", "org_helm_registry_credentials", "helm_registry_credential_id", userID)
		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(500, gin.H{"error": "failed to list Helm registry credentials"})
			return
		}
		c.JSON(200, gin.H{"data": redactAll(items)})
	}
}

func Create(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		var body request
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		if err := validate(&body, true); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		ownerType, ownerUserID := models.OwnerTypeUser, &userID
		var ownerOrgID *uuid.UUID
		if strings.TrimSpace(body.OrgID) != "" {
			id, err := uuid.Parse(body.OrgID)
			if err != nil {
				c.JSON(400, gin.H{"error": "invalid org_id"})
				return
			}
			if _, _, _, _, ok := authz.RequireOrgRole(c, db, id, models.OrgRoleEditor); !ok {
				return
			}
			ownerType, ownerUserID, ownerOrgID = models.OwnerTypeOrg, nil, &id
		}
		secret, err := crypto.Encrypt(crypto.KeyFromString(config.Config.Encryption.Key), body.Secret)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to encrypt credential"})
			return
		}
		item := &models.HelmRegistryCredential{Name: strings.TrimSpace(body.Name), URL: normalizeURL(body.URL), Protocol: body.Protocol, AuthType: body.AuthType, Username: strings.TrimSpace(body.Username), EncryptedSecret: secret, CreatedByID: userID, OwnerType: ownerType, OwnerUserID: ownerUserID, OwnerOrgID: ownerOrgID, CreatedAt: time.Now(), UpdatedAt: time.Now()}
		if _, err := db.NewInsert().Model(item).Exec(c.Request.Context()); err != nil {
			c.JSON(500, gin.H{"error": "failed to create Helm registry credential"})
			return
		}
		if ownerOrgID != nil {
			_, _ = db.NewInsert().Model(&models.OrgHelmRegistryCredential{OrgID: *ownerOrgID, HelmRegistryCredentialID: item.ID}).On("CONFLICT DO NOTHING").Exec(c.Request.Context())
		}
		c.JSON(201, redact(item))
	}
}

func Update(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid credential ID"})
			return
		}
		item, _, _, ok := authz.LoadAuthorizedHelmRegistryCredential(c, db, id)
		if !ok {
			return
		}
		var body request
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		if body.Name != "" {
			item.Name = strings.TrimSpace(body.Name)
		}
		if body.URL != "" {
			item.URL = normalizeURL(body.URL)
		}
		if body.Protocol != "" {
			item.Protocol = body.Protocol
		}
		if body.AuthType != "" {
			item.AuthType = body.AuthType
		}
		if body.Username != "" || body.AuthType == models.HelmRegistryAuthBearerToken {
			item.Username = strings.TrimSpace(body.Username)
		}
		check := request{Name: item.Name, URL: item.URL, Protocol: item.Protocol, AuthType: item.AuthType, Username: item.Username, Secret: "preserved"}
		if err := validate(&check, false); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		if body.Secret != "" {
			encrypted, err := crypto.Encrypt(crypto.KeyFromString(config.Config.Encryption.Key), body.Secret)
			if err != nil {
				c.JSON(500, gin.H{"error": "failed to encrypt credential"})
				return
			}
			item.EncryptedSecret = encrypted
		}
		item.UpdatedAt = time.Now()
		if _, err := db.NewUpdate().Model(item).Column("name", "url", "protocol", "auth_type", "username", "encrypted_secret", "updated_at").Where("id = ?", id).Exec(c.Request.Context()); err != nil {
			c.JSON(500, gin.H{"error": "failed to update Helm registry credential"})
			return
		}
		c.JSON(200, redact(item))
	}
}

func Delete(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid credential ID"})
			return
		}
		if _, _, _, ok := authz.LoadAuthorizedHelmRegistryCredential(c, db, id); !ok {
			return
		}
		used, err := db.NewSelect().Table("git_repository_helm_sources").Where("helm_registry_credential_id = ?", id).Exists(c.Request.Context())
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to check Helm source usage"})
			return
		}
		if used {
			c.JSON(409, gin.H{"error": "credential is used by a managed Helm source; select another credential first"})
			return
		}
		if _, err := db.NewDelete().Model((*models.HelmRegistryCredential)(nil)).Where("id = ?", id).Exec(c.Request.Context()); err != nil {
			c.JSON(500, gin.H{"error": "failed to delete Helm registry credential"})
			return
		}
		c.JSON(200, gin.H{"result": "deleted"})
	}
}

func Test(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid credential ID"})
			return
		}
		item, _, _, ok := authz.LoadAuthorizedHelmRegistryCredential(c, db, id)
		if !ok {
			return
		}
		secret, err := crypto.Decrypt(crypto.KeyFromString(config.Config.Encryption.Key), item.EncryptedSecret)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to decrypt credential"})
			return
		}
		message := testCredential(c.Request.Context(), item, secret)
		now := time.Now()
		item.LastHealthCheckAt = &now
		if message == "" {
			item.HealthStatus = "healthy"
			item.HealthMessage = "authentication succeeded"
		} else {
			item.HealthStatus = "unhealthy"
			item.HealthMessage = message
		}
		_, _ = db.NewUpdate().Model(item).Column("health_status", "health_message", "last_health_check_at").Where("id = ?", item.ID).Exec(c.Request.Context())
		c.JSON(200, gin.H{"health_status": item.HealthStatus, "health_message": item.HealthMessage, "last_health_check_at": item.LastHealthCheckAt})
	}
}

func ListShares(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, _, _, ok := loadForShares(c, db)
		if !ok {
			return
		}

		type credentialShare struct {
			OrgID          uuid.UUID `bun:"org_id" json:"org_id"`
			OrgName        string    `bun:"org_name" json:"org_name"`
			OrgDescription string    `bun:"org_description" json:"org_description"`
			IsOwner        bool      `bun:"-" json:"is_owner"`
		}
		var shares []credentialShare
		if err := db.NewSelect().
			TableExpr("org_helm_registry_credentials AS credential_share").
			ColumnExpr("o.id AS org_id").
			ColumnExpr("o.name AS org_name").
			ColumnExpr("COALESCE(o.description, '') AS org_description").
			Join("JOIN orgs AS o ON o.id = credential_share.org_id").
			Where("credential_share.helm_registry_credential_id = ?", item.ID).
			OrderExpr("o.name ASC").
			Scan(c.Request.Context(), &shares); err != nil {
			c.JSON(500, gin.H{"error": "failed to list shares"})
			return
		}
		for index := range shares {
			shares[index].IsOwner = item.OwnerOrgID != nil && *item.OwnerOrgID == shares[index].OrgID
		}
		c.JSON(200, gin.H{"data": shares})
	}
}
func Share(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, _, admin, ok := loadForShares(c, db)
		if !ok {
			return
		}
		var body struct {
			OrgID string `json:"org_id" binding:"required"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		orgID, err := uuid.Parse(body.OrgID)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid org_id"})
			return
		}
		if !admin {
			if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleEditor); !ok {
				return
			}
		}
		_, err = db.NewInsert().Model(&models.OrgHelmRegistryCredential{OrgID: orgID, HelmRegistryCredentialID: item.ID}).On("CONFLICT DO NOTHING").Exec(c.Request.Context())
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to share credential"})
			return
		}
		c.JSON(201, gin.H{"result": "shared"})
	}
}
func Unshare(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, _, _, ok := loadForShares(c, db)
		if !ok {
			return
		}
		orgID, err := uuid.Parse(c.Param("orgId"))
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid org_id"})
			return
		}
		if item.OwnerOrgID != nil && *item.OwnerOrgID == orgID {
			c.JSON(400, gin.H{"error": "cannot remove the owner organization"})
			return
		}
		_, err = db.NewDelete().Model((*models.OrgHelmRegistryCredential)(nil)).Where("org_id = ?", orgID).Where("helm_registry_credential_id = ?", item.ID).Exec(c.Request.Context())
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to revoke credential share"})
			return
		}
		c.JSON(200, gin.H{"result": "unshared"})
	}
}
func Transfer(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid credential ID"})
			return
		}
		item := &models.HelmRegistryCredential{}
		if err := db.NewSelect().Model(item).Where("id = ?", id).Scan(c.Request.Context()); err != nil {
			c.JSON(404, gin.H{"error": "Helm registry credential not found"})
			return
		}
		if _, ok := resourceownership.TransferOrgOwnedResource(c, db, resourceownership.TransferParams{ResourceID: item.ID, OwnerType: item.OwnerType, OwnerOrgID: item.OwnerOrgID, ResourceTable: "helm_registry_credentials", LinkTable: "org_helm_registry_credentials", LinkResourceColumn: "helm_registry_credential_id", ResourceName: "helm_registry_credential", HasUpdatedAt: true}); !ok {
			return
		}
		c.JSON(200, gin.H{"result": "ownership transferred"})
	}
}

func loadForShares(c *gin.Context, db *bun.DB) (*models.HelmRegistryCredential, uuid.UUID, bool, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid credential ID"})
		return nil, uuid.Nil, false, false
	}
	return authz.LoadAuthorizedHelmRegistryCredential(c, db, id)
}
func redact(item *models.HelmRegistryCredential) *models.HelmRegistryCredential {
	copy := *item
	copy.CredentialConfigured = copy.EncryptedSecret != ""
	copy.EncryptedSecret = ""
	return &copy
}
func redactAll(items []models.HelmRegistryCredential) []models.HelmRegistryCredential {
	for i := range items {
		items[i].CredentialConfigured = items[i].EncryptedSecret != ""
		items[i].EncryptedSecret = ""
	}
	return items
}
func validate(b *request, requireSecret bool) error {
	b.Name = strings.TrimSpace(b.Name)
	b.Protocol = strings.TrimSpace(b.Protocol)
	b.AuthType = strings.TrimSpace(b.AuthType)
	if b.Name == "" {
		return fmt.Errorf("name is required")
	}
	if b.Protocol != models.HelmRegistryProtocolOCI && b.Protocol != models.HelmRegistryProtocolHTTP {
		return fmt.Errorf("protocol must be oci or http")
	}
	if b.AuthType != models.HelmRegistryAuthBasic && b.AuthType != models.HelmRegistryAuthAccessToken && b.AuthType != models.HelmRegistryAuthBearerToken {
		return fmt.Errorf("invalid authentication type")
	}
	if b.Protocol == models.HelmRegistryProtocolHTTP && b.AuthType == models.HelmRegistryAuthBearerToken {
		return fmt.Errorf("bearer token authentication is supported only for OCI")
	}
	if b.AuthType != models.HelmRegistryAuthBearerToken && strings.TrimSpace(b.Username) == "" {
		return fmt.Errorf("username is required")
	}
	if requireSecret && strings.TrimSpace(b.Secret) == "" {
		return fmt.Errorf("credential secret is required")
	}
	parsed, err := url.Parse(strings.TrimSpace(b.URL))
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("URL must be a credential-free registry endpoint")
	}
	if b.Protocol == models.HelmRegistryProtocolOCI && parsed.Scheme != "oci" && parsed.Scheme != "https" {
		return fmt.Errorf("OCI URL must use oci:// or https://")
	}
	if b.Protocol == models.HelmRegistryProtocolHTTP && parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("HTTP chart repository URL must use http:// or https://")
	}
	return nil
}
func normalizeURL(raw string) string { return strings.TrimRight(strings.TrimSpace(raw), "/") }
func testCredential(ctx context.Context, item *models.HelmRegistryCredential, secret string) string {
	if item.Protocol == models.HelmRegistryProtocolHTTP {
		endpoint := strings.TrimRight(item.URL, "/") + "/index.yaml"
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return "invalid endpoint"
		}
		req.SetBasicAuth(item.Username, secret)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return "could not reach chart repository"
		}
		defer res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			return fmt.Sprintf("chart repository returned HTTP %d", res.StatusCode)
		}
		return ""
	}
	parsed, _ := url.Parse(item.URL)
	host := parsed.Host
	if host == "" {
		host = strings.TrimPrefix(strings.TrimPrefix(item.URL, "oci://"), "https://")
		host = strings.Split(host, "/")[0]
	}
	if item.AuthType == models.HelmRegistryAuthBearerToken {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://"+host+"/v2/", nil)
		if err != nil {
			return "invalid endpoint"
		}
		req.Header.Set("Authorization", "Bearer "+secret)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return "could not reach OCI registry"
		}
		defer res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			return fmt.Sprintf("OCI registry returned HTTP %d", res.StatusCode)
		}
		return ""
	}
	home, err := os.MkdirTemp("", "justscan-helm-test-")
	if err != nil {
		return "could not create temporary Helm configuration"
	}
	defer os.RemoveAll(home)
	cmd := exec.CommandContext(ctx, "helm", "registry", "login", host, "--username", item.Username, "--password-stdin", "--registry-config", path.Join(home, "registry.json"))
	cmd.Stdin = strings.NewReader(secret)
	if output, err := cmd.CombinedOutput(); err != nil {
		return "OCI authentication failed: " + sanitizeHelmOutput(string(output))
	}
	return ""
}
func sanitizeHelmOutput(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "authentication rejected"
	}
	if len(value) > 300 {
		return value[:300]
	}
	return value
}
