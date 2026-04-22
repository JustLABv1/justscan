package auths

import (
	"context"
	"fmt"
	"strings"
	"time"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

type desiredOIDCMembership struct {
	OrgID          uuid.UUID
	Role           string
	MappingID      *uuid.UUID
	RemoveOnUnsync bool
}

// syncOIDCClaimOrgs syncs the user's org memberships based on explicit claim
// mapping rules for the provider. Rules may match groups or roles, exact values
// or prefixes, and may either target an existing org or provision one by name.
func syncOIDCClaimOrgs(ctx context.Context, db *bun.DB, userID uuid.UUID, providerName string, groups, roles []string) {
	var mappings []models.OIDCGroupOrgMapping
	if err := db.NewSelect().Model(&mappings).Where("provider_name = ?", providerName).Scan(ctx); err != nil {
		log.Warnf("oidc-sync: failed to load claim mappings for provider %q: %v", providerName, err)
		return
	}

	mappingByID := make(map[uuid.UUID]models.OIDCGroupOrgMapping, len(mappings))
	shouldBeMember := make(map[string]desiredOIDCMembership)

	for _, m := range mappings {
		mappingByID[m.ID] = m
		for _, claim := range claimsForMapping(m, groups, roles) {
			matched, suffix := mappingMatches(m, claim)
			if !matched {
				continue
			}

			orgID, err := ensureOrgForMapping(ctx, db, userID, providerName, m, claim, suffix)
			if err != nil {
				log.Warnf("oidc-sync: failed to ensure org for mapping %s and claim %q: %v", m.ID, claim, err)
				continue
			}
			if orgID == uuid.Nil {
				continue
			}

			desired := desiredOIDCMembership{
				OrgID:          orgID,
				Role:           normalizeMappingRole(m.Role),
				MappingID:      pointerToUUID(m.ID),
				RemoveOnUnsync: m.RemoveOnUnsync,
			}

			existing, exists := shouldBeMember[orgID.String()]
			if !exists || rolePriority(desired.Role) > rolePriority(existing.Role) {
				shouldBeMember[orgID.String()] = desired
			}
		}
	}

	for _, desired := range shouldBeMember {
		upsertOIDCMembership(ctx, db, userID, desired.OrgID, desired.Role, providerName, desired.MappingID)
	}

	// Remove OIDC-synced memberships from this provider that no longer apply.
	var existingLinks []models.OrgMember
	if err := db.NewSelect().Model(&existingLinks).
		Where("user_id = ? AND oidc_synced = true AND oidc_provider = ?", userID, providerName).
		Scan(ctx); err != nil {
		return
	}

	for _, link := range existingLinks {
		if _, keep := shouldBeMember[link.OrgID.String()]; keep {
			continue
		}
		if !shouldRemoveOIDCMembership(link, mappings, mappingByID) {
			continue
		}
		if _, err := db.NewDelete().Model((*models.OrgMember)(nil)).
			Where("org_id = ? AND user_id = ? AND oidc_synced = true AND oidc_provider = ?",
				link.OrgID, userID, providerName).
			Exec(ctx); err != nil {
			log.Warnf("oidc-sync: failed to remove stale membership org=%s user=%s: %v",
				link.OrgID, userID, err)
		} else {
			log.Infof("oidc-sync: removed user %s from org %s (no longer matched by OIDC claims)", userID, link.OrgID)
		}
	}
}

func claimsForMapping(mapping models.OIDCGroupOrgMapping, groups, roles []string) []string {
	if mapping.ClaimType == "role" {
		return roles
	}
	return groups
}

func mappingMatches(mapping models.OIDCGroupOrgMapping, claim string) (bool, string) {
	switch mapping.MatchType {
	case "prefix":
		if !strings.HasPrefix(claim, mapping.MatchValue) {
			return false, ""
		}
		suffix := strings.TrimSpace(strings.TrimPrefix(claim, mapping.MatchValue))
		if suffix == "" {
			return false, ""
		}
		return true, suffix
	default:
		return claim == mapping.MatchValue, ""
	}
}

func ensureOrgForMapping(ctx context.Context, db *bun.DB, userID uuid.UUID, providerName string, mapping models.OIDCGroupOrgMapping, claim, suffix string) (uuid.UUID, error) {
	switch mapping.ProvisioningMode {
	case "create_org":
		orgName, err := renderOrgName(mapping, claim, suffix, providerName)
		if err != nil {
			return uuid.Nil, err
		}
		return findOrCreateOrgByName(ctx, db, userID, orgName, mapping, claim, providerName)
	case "existing_org", "":
		if mapping.OrgID == nil {
			return uuid.Nil, fmt.Errorf("existing_org mapping %s is missing org_id", mapping.ID)
		}
		exists, err := db.NewSelect().Model((*models.Org)(nil)).Where("id = ?", *mapping.OrgID).Exists(ctx)
		if err != nil {
			return uuid.Nil, err
		}
		if exists {
			return *mapping.OrgID, nil
		}
		if !mapping.RecreateMissingOrg {
			return uuid.Nil, nil
		}
		orgName, err := renderOrgName(mapping, claim, suffix, providerName)
		if err != nil {
			return uuid.Nil, err
		}
		return recreateMissingOrg(ctx, db, userID, *mapping.OrgID, orgName, mapping, claim, providerName)
	default:
		return uuid.Nil, fmt.Errorf("unsupported provisioning mode %q", mapping.ProvisioningMode)
	}
}

func renderOrgName(mapping models.OIDCGroupOrgMapping, claim, suffix, providerName string) (string, error) {
	template := strings.TrimSpace(mapping.OrgNameTemplate)
	if template == "" {
		return "", fmt.Errorf("mapping %s is missing org_name_template", mapping.ID)
	}
	if mapping.MatchType != "prefix" && strings.Contains(template, "{suffix}") {
		return "", fmt.Errorf("mapping %s uses {suffix} with non-prefix matching", mapping.ID)
	}
	rendered := strings.ReplaceAll(template, "{claim}", claim)
	rendered = strings.ReplaceAll(rendered, "{suffix}", suffix)
	rendered = strings.ReplaceAll(rendered, "{provider}", providerName)
	rendered = strings.Join(strings.Fields(rendered), " ")
	if rendered == "" {
		return "", fmt.Errorf("mapping %s rendered an empty org name", mapping.ID)
	}
	return rendered, nil
}

func findOrCreateOrgByName(ctx context.Context, db *bun.DB, userID uuid.UUID, orgName string, mapping models.OIDCGroupOrgMapping, claim, providerName string) (uuid.UUID, error) {
	var existing models.Org
	if err := db.NewSelect().Model(&existing).Where("name = ?", orgName).Scan(ctx); err == nil {
		return existing.ID, nil
	}

	now := time.Now()
	newOrg := &models.Org{
		Name:        orgName,
		Description: fmt.Sprintf("Provisioned from OIDC %s claim %q via provider %s", mapping.ClaimType, claim, providerName),
		CreatedByID: userID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if _, err := db.NewInsert().Model(newOrg).Exec(ctx); err != nil {
		if err := db.NewSelect().Model(&existing).Where("name = ?", orgName).Scan(ctx); err == nil {
			return existing.ID, nil
		}
		return uuid.Nil, err
	}
	log.Infof("oidc-sync: provisioned org %q for provider %q via mapping %s", orgName, providerName, mapping.ID)
	return newOrg.ID, nil
}

func recreateMissingOrg(ctx context.Context, db *bun.DB, userID, orgID uuid.UUID, orgName string, mapping models.OIDCGroupOrgMapping, claim, providerName string) (uuid.UUID, error) {
	now := time.Now()
	newOrg := &models.Org{
		ID:          orgID,
		Name:        orgName,
		Description: fmt.Sprintf("Recreated from OIDC %s claim %q via provider %s", mapping.ClaimType, claim, providerName),
		CreatedByID: userID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if _, err := db.NewInsert().Model(newOrg).Exec(ctx); err != nil {
		var existing models.Org
		if errByID := db.NewSelect().Model(&existing).Where("id = ?", orgID).Scan(ctx); errByID == nil {
			return existing.ID, nil
		}
		return uuid.Nil, err
	}
	log.Infof("oidc-sync: recreated org %q (id=%s) for provider %q via mapping %s", orgName, orgID, providerName, mapping.ID)
	return orgID, nil
}

func shouldRemoveOIDCMembership(link models.OrgMember, mappings []models.OIDCGroupOrgMapping, mappingByID map[uuid.UUID]models.OIDCGroupOrgMapping) bool {
	if link.OIDCMappingID != nil {
		if mapping, ok := mappingByID[*link.OIDCMappingID]; ok {
			return mapping.RemoveOnUnsync
		}
	}
	for _, mapping := range mappings {
		if mapping.OrgID != nil && *mapping.OrgID == link.OrgID {
			return mapping.RemoveOnUnsync
		}
	}
	return true
}

func normalizeMappingRole(role string) string {
	switch role {
	case models.OrgRoleAdmin:
		return models.OrgRoleAdmin
	case models.OrgRoleEditor:
		return models.OrgRoleEditor
	default:
		return models.OrgRoleViewer
	}
}

func rolePriority(role string) int {
	switch role {
	case models.OrgRoleAdmin:
		return 3
	case models.OrgRoleEditor:
		return 2
	default:
		return 1
	}
}

func pointerToUUID(value uuid.UUID) *uuid.UUID {
	v := value
	return &v
}

// upsertOIDCMembership adds or updates the oidc-synced membership for a user in an org.
func upsertOIDCMembership(ctx context.Context, db *bun.DB, userID, orgID uuid.UUID, role, providerName string, mappingID *uuid.UUID) {
	now := time.Now()
	member := models.OrgMember{
		OrgID:         orgID,
		UserID:        userID,
		Role:          role,
		JoinedAt:      now,
		CreatedAt:     now,
		UpdatedAt:     now,
		OIDCSynced:    true,
		OIDCProvider:  providerName,
		OIDCMappingID: mappingID,
	}
	_, err := db.NewInsert().Model(&member).
		On("CONFLICT (org_id, user_id) DO UPDATE").
		// Only update role/provider if this is an oidc-synced membership.
		Set("role = CASE WHEN org_members.oidc_synced THEN EXCLUDED.role ELSE org_members.role END").
		Set("oidc_synced = CASE WHEN org_members.oidc_synced THEN true ELSE org_members.oidc_synced END").
		Set("oidc_provider = CASE WHEN org_members.oidc_synced THEN EXCLUDED.oidc_provider ELSE org_members.oidc_provider END").
		Set("oidc_mapping_id = CASE WHEN org_members.oidc_synced THEN EXCLUDED.oidc_mapping_id ELSE org_members.oidc_mapping_id END").
		Set("updated_at = now()").
		Exec(ctx)
	if err != nil {
		log.Warnf("oidc-sync: failed to upsert membership org=%s user=%s: %v", orgID, userID, err)
	}
}
