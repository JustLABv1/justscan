package auths

import (
	"context"
	"time"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// syncOIDCGroupOrgs syncs the user's org memberships based on OIDC group claims
// and the configured oidc_group_org_mappings for the provider.
//
// Rules:
//   - If a group mapping matches, add the user to the org with the specified role
//     (or update role if they are already an oidc-synced member).
//   - If remove_on_unsync = true, remove the user from orgs where they were added
//     via this provider but no longer match any group.
//   - Manually-added members (oidc_synced = false) are never touched.
func syncOIDCGroupOrgs(ctx context.Context, db *bun.DB, userID uuid.UUID, providerName string, groups []string) {
	// Build a set for O(1) lookup.
	groupSet := make(map[string]struct{}, len(groups))
	for _, g := range groups {
		groupSet[g] = struct{}{}
	}

	// Load all mappings for this provider.
	var mappings []models.OIDCGroupOrgMapping
	if err := db.NewSelect().Model(&mappings).Where("provider_name = ?", providerName).Scan(ctx); err != nil {
		log.Warnf("oidc-sync: failed to load group mappings for provider %q: %v", providerName, err)
		return
	}

	// Track orgs the user should be a member of via this provider.
	shouldBeMember := make(map[string]models.OIDCGroupOrgMapping) // org_id → mapping

	for _, m := range mappings {
		if _, matched := groupSet[m.OIDCGroup]; !matched {
			continue
		}

		orgID, err := ensureOrg(ctx, db, m)
		if err != nil {
			log.Warnf("oidc-sync: failed to ensure org for mapping %s: %v", m.ID, err)
			continue
		}
		shouldBeMember[orgID.String()] = m

		upsertOIDCMembership(ctx, db, userID, orgID, m.Role, providerName)
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
		// Check if this org had a mapping that says remove_on_unsync.
		// If there's no mapping at all for this org+provider, we also remove
		// (the mapping was likely deleted).
		var mapping *models.OIDCGroupOrgMapping
		for i := range mappings {
			if mappings[i].OrgID == link.OrgID.String() {
				mapping = &mappings[i]
				break
			}
		}
		if mapping != nil && !mapping.RemoveOnUnsync {
			continue
		}
		if _, err := db.NewDelete().Model((*models.OrgMember)(nil)).
			Where("org_id = ? AND user_id = ? AND oidc_synced = true AND oidc_provider = ?",
				link.OrgID, userID, providerName).
			Exec(ctx); err != nil {
			log.Warnf("oidc-sync: failed to remove stale membership org=%s user=%s: %v",
				link.OrgID, userID, err)
		} else {
			log.Infof("oidc-sync: removed user %s from org %s (no longer in OIDC group)", userID, link.OrgID)
		}
	}
}

// ensureOrg finds the org by ID. If auto_create_org is set and the org does not
// exist, it creates one named after the OIDC group.
func ensureOrg(ctx context.Context, db *bun.DB, m models.OIDCGroupOrgMapping) (uuid.UUID, error) {
	orgID, err := uuid.Parse(m.OrgID)
	if err != nil {
		return uuid.Nil, err
	}

	exists, err := db.NewSelect().Model((*models.Org)(nil)).Where("id = ?", orgID).Exists(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	if exists {
		return orgID, nil
	}

	if !m.AutoCreateOrg {
		return uuid.Nil, nil // org gone and auto-create disabled; skip
	}

	// Create a new org using the OIDC group name.
	newOrg := &models.Org{
		ID:          orgID,
		Name:        m.OIDCGroup,
		Description: "Auto-created from OIDC group: " + m.OIDCGroup,
		CreatedByID: uuid.Nil, // system-created
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	if _, err := db.NewInsert().Model(newOrg).On("CONFLICT (id) DO NOTHING").Exec(ctx); err != nil {
		return uuid.Nil, err
	}
	log.Infof("oidc-sync: auto-created org %q (id=%s) for group %q", newOrg.Name, orgID, m.OIDCGroup)
	return orgID, nil
}

// upsertOIDCMembership adds or updates the oidc-synced membership for a user in an org.
func upsertOIDCMembership(ctx context.Context, db *bun.DB, userID, orgID uuid.UUID, role, providerName string) {
	now := time.Now()
	member := models.OrgMember{
		OrgID:        orgID,
		UserID:       userID,
		Role:         role,
		JoinedAt:     now,
		CreatedAt:    now,
		UpdatedAt:    now,
		OIDCSynced:   true,
		OIDCProvider: providerName,
	}
	_, err := db.NewInsert().Model(&member).
		On("CONFLICT (org_id, user_id) DO UPDATE").
		// Only update role/provider if this is an oidc-synced membership.
		Set("role = CASE WHEN org_members.oidc_synced THEN EXCLUDED.role ELSE org_members.role END").
		Set("oidc_synced = CASE WHEN org_members.oidc_synced THEN true ELSE org_members.oidc_synced END").
		Set("oidc_provider = CASE WHEN org_members.oidc_synced THEN EXCLUDED.oidc_provider ELSE org_members.oidc_provider END").
		Set("updated_at = now()").
		Exec(ctx)
	if err != nil {
		log.Warnf("oidc-sync: failed to upsert membership org=%s user=%s: %v", orgID, userID, err)
	}
}
