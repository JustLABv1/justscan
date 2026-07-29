package authz

import (
	"context"
	"database/sql"
	"net/http"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func LoadAuthorizedHelmRegistryCredential(c *gin.Context, db *bun.DB, id uuid.UUID) (*models.HelmRegistryCredential, uuid.UUID, bool, bool) {
	userID, isAdmin, ok := RequireRequestUser(c, db)
	if !ok {
		return nil, uuid.Nil, false, false
	}
	credential := &models.HelmRegistryCredential{}
	if err := db.NewSelect().Model(credential).Where("id = ?", id).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Helm registry credential not found"})
		return nil, uuid.Nil, false, false
	}
	if isAdmin || credential.CreatedByID == userID || (credential.OwnerUserID != nil && *credential.OwnerUserID == userID) {
		return credential, userID, isAdmin, true
	}
	if credential.OwnerOrgID != nil {
		roles, err := LoadUserOrgRoles(c.Request.Context(), db, userID)
		if err == nil && HasOrgRoleAtLeast(roles, *credential.OwnerOrgID, models.OrgRoleEditor) {
			return credential, userID, isAdmin, true
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "Helm registry credential not found"})
	return nil, uuid.Nil, false, false
}

func CanOrgAccessHelmRegistryCredential(ctx context.Context, db *bun.DB, orgID uuid.UUID, credential *models.HelmRegistryCredential) (bool, error) {
	if credential == nil {
		return false, nil
	}
	if credential.OwnerOrgID != nil && *credential.OwnerOrgID == orgID {
		return true, nil
	}
	return db.NewSelect().Model((*models.OrgHelmRegistryCredential)(nil)).Where("helm_registry_credential_id = ?", credential.ID).Where("org_id = ?", orgID).Exists(ctx)
}

func HelmRegistryCredentialBelongsToRepository(ctx context.Context, db *bun.DB, repository *models.GitRepository, credential *models.HelmRegistryCredential) (bool, error) {
	if repository == nil || credential == nil {
		return false, nil
	}
	if repository.OwnerOrgID != nil {
		return CanOrgAccessHelmRegistryCredential(ctx, db, *repository.OwnerOrgID, credential)
	}
	return repository.OwnerUserID != nil && credential.OwnerUserID != nil && *repository.OwnerUserID == *credential.OwnerUserID, nil
}

func LoadHelmRegistryCredentialForRepository(ctx context.Context, db *bun.DB, repository models.GitRepository, id uuid.UUID) (*models.HelmRegistryCredential, error) {
	credential := &models.HelmRegistryCredential{}
	if err := db.NewSelect().Model(credential).Where("id = ?", id).Scan(ctx); err != nil {
		return nil, err
	}
	allowed, err := HelmRegistryCredentialBelongsToRepository(ctx, db, &repository, credential)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, sql.ErrNoRows
	}
	return credential, nil
}
