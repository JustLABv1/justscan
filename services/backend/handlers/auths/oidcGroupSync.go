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
	OrgID          *uuid.UUID
	OrgName        string
	Role           string
	MappingID      *uuid.UUID
	RemoveOnUnsync bool
	Mapping        models.OIDCGroupOrgMapping
	Claim          string
	Suffix         string
	RequiresCreate bool
}

type oidcClaimBlockers struct {
	groups []models.OIDCGroupOrgMapping
	roles  []models.OIDCGroupOrgMapping
}

type oidcRouteCandidate struct {
	OrgKey         string
	OrgID          *uuid.UUID
	OrgName        string
	Claim          string
	Suffix         string
	Mapping        models.OIDCGroupOrgMapping
	BaseRole       string
	RequiresCreate bool
}

// syncOIDCClaimOrgs syncs the user's org memberships based on explicit claim
// mapping rules for the provider. Rules may match groups or roles, exact values
// or prefixes, and may either target an existing org or provision one by name.
func syncOIDCClaimOrgs(ctx context.Context, db *bun.DB, userID uuid.UUID, providerName string, groups, roles []string) {
	result, err := evaluateOIDCClaimSync(ctx, db, providerName, groups, roles)
	if err != nil {
		log.Warnf("oidc-sync: failed to evaluate claims for provider %q: %v", providerName, err)
		return
	}

	keptOrgIDs := make(map[string]struct{}, len(result.DesiredMemberships))
	for _, desired := range result.DesiredMemberships {
		orgID, err := ensureDesiredMembership(ctx, db, userID, providerName, desired)
		if err != nil {
			log.Warnf("oidc-sync: failed to apply membership for org %q via mapping %s: %v", desired.OrgName, desired.Mapping.ID, err)
			continue
		}
		keptOrgIDs[orgID.String()] = struct{}{}
	}

	// Remove OIDC-synced memberships from this provider that no longer apply.
	var existingLinks []models.OrgMember
	if err := db.NewSelect().Model(&existingLinks).
		Where("user_id = ? AND oidc_synced = true AND oidc_provider = ?", userID, providerName).
		Scan(ctx); err != nil {
		return
	}

	for _, link := range existingLinks {
		if _, keep := keptOrgIDs[link.OrgID.String()]; keep {
			continue
		}
		if !shouldRemoveOIDCMembership(link, result.Mappings, result.MappingByID) {
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

func filterBlockedClaims(claimType string, claims []string, blockers oidcClaimBlockers) []string {
	if len(claims) == 0 {
		return nil
	}
	filtered := make([]string, 0, len(claims))
	for _, claim := range claims {
		if claimBlocked(claimType, claim, blockers) {
			continue
		}
		filtered = append(filtered, claim)
	}
	return filtered
}

func claimsForMapping(mapping models.OIDCGroupOrgMapping, groups, roles []string) []string {
	if mapping.ClaimType == "role" {
		return roles
	}
	return groups
}

func buildClaimBlockers(mappings []models.OIDCGroupOrgMapping) oidcClaimBlockers {
	blockers := oidcClaimBlockers{}
	for _, mapping := range mappings {
		if mapping.Effect != "exclude" {
			continue
		}
		if mapping.ClaimType == "role" {
			blockers.roles = append(blockers.roles, mapping)
			continue
		}
		blockers.groups = append(blockers.groups, mapping)
	}
	return blockers
}

func claimBlocked(claimType, claim string, blockers oidcClaimBlockers) bool {
	var candidates []models.OIDCGroupOrgMapping
	if claimType == "role" {
		candidates = blockers.roles
	} else {
		candidates = blockers.groups
	}
	for _, blocker := range candidates {
		matched, _ := mappingMatches(blocker, claim)
		if matched {
			return true
		}
	}
	return false
}

func filterProviderGroups(provider models.OIDCProvider, groups []string) []string {
	if len(groups) == 0 {
		return nil
	}
	included := make(map[string]struct{}, len(provider.IncludedGroups))
	for _, group := range provider.IncludedGroups {
		trimmed := strings.TrimSpace(group)
		if trimmed != "" {
			included[trimmed] = struct{}{}
		}
	}
	excluded := make(map[string]struct{}, len(provider.ExcludedGroups))
	for _, group := range provider.ExcludedGroups {
		trimmed := strings.TrimSpace(group)
		if trimmed != "" {
			excluded[trimmed] = struct{}{}
		}
	}
	filtered := make([]string, 0, len(groups))
	for _, group := range groups {
		if _, blocked := excluded[group]; blocked {
			continue
		}
		if len(included) > 0 {
			if _, allowed := included[group]; !allowed {
				continue
			}
		}
		filtered = append(filtered, group)
	}
	return filtered
}

func derivedOrgAllowed(provider models.OIDCProvider, orgName string) bool {
	if orgName == "" {
		return false
	}
	included := make(map[string]struct{}, len(provider.IncludedOrgNames))
	for _, name := range provider.IncludedOrgNames {
		trimmed := strings.TrimSpace(name)
		if trimmed != "" {
			included[trimmed] = struct{}{}
		}
	}
	excluded := make(map[string]struct{}, len(provider.ExcludedOrgNames))
	for _, name := range provider.ExcludedOrgNames {
		trimmed := strings.TrimSpace(name)
		if trimmed != "" {
			excluded[trimmed] = struct{}{}
		}
	}
	if _, blocked := excluded[orgName]; blocked {
		return false
	}
	if len(included) == 0 {
		return true
	}
	_, ok := included[orgName]
	return ok
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

func resolveRouteCandidate(ctx context.Context, db *bun.DB, userID uuid.UUID, providerName string, mapping models.OIDCGroupOrgMapping, claim, suffix string) (*oidcRouteCandidate, error) {
	baseRole := normalizeMappingRole(mapping.Role)
	if mapping.ProvisioningMode == "create_org" && strings.TrimSpace(mapping.Role) == "" {
		baseRole = models.OrgRoleAdmin
	}

	switch mapping.ProvisioningMode {
	case "create_org":
		orgName, err := renderOrgName(mapping, claim, suffix, providerName)
		if err != nil {
			return nil, err
		}
		var existing models.Org
		if err := db.NewSelect().Model(&existing).Where("name = ?", orgName).Scan(ctx); err == nil {
			return &oidcRouteCandidate{
				OrgKey:   existing.ID.String(),
				OrgID:    pointerToUUID(existing.ID),
				OrgName:  existing.Name,
				Claim:    claim,
				Suffix:   suffix,
				Mapping:  mapping,
				BaseRole: baseRole,
			}, nil
		}
		return &oidcRouteCandidate{
			OrgKey:         "name:" + orgName,
			OrgName:        orgName,
			Claim:          claim,
			Suffix:         suffix,
			Mapping:        mapping,
			BaseRole:       baseRole,
			RequiresCreate: true,
		}, nil
	case "existing_org", "":
		if mapping.OrgID == nil {
			return nil, fmt.Errorf("existing_org mapping %s is missing org_id", mapping.ID)
		}
		var existing models.Org
		if err := db.NewSelect().Model(&existing).Where("id = ?", *mapping.OrgID).Scan(ctx); err == nil {
			return &oidcRouteCandidate{
				OrgKey:   existing.ID.String(),
				OrgID:    pointerToUUID(existing.ID),
				OrgName:  existing.Name,
				Claim:    claim,
				Suffix:   suffix,
				Mapping:  mapping,
				BaseRole: baseRole,
			}, nil
		}
		if !mapping.RecreateMissingOrg {
			return nil, nil
		}
		orgName, err := renderOrgName(mapping, claim, suffix, providerName)
		if err != nil {
			return nil, err
		}
		return &oidcRouteCandidate{
			OrgKey:         mapping.OrgID.String(),
			OrgID:          pointerToUUID(*mapping.OrgID),
			OrgName:        orgName,
			Claim:          claim,
			Suffix:         suffix,
			Mapping:        mapping,
			BaseRole:       baseRole,
			RequiresCreate: true,
		}, nil
	default:
		return nil, fmt.Errorf("unsupported provisioning mode %q", mapping.ProvisioningMode)
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
	return renderOIDCNameTemplate(mapping.ID.String(), mapping.MatchType, mapping.OrgNameTemplate, claim, suffix, providerName)
}

func renderOIDCNameTemplate(ruleID, matchType, template, claim, suffix, providerName string) (string, error) {
	template = strings.TrimSpace(template)
	if template == "" {
		return "", fmt.Errorf("mapping %s is missing org_name_template", ruleID)
	}
	if matchType != "prefix" && strings.Contains(template, "{suffix}") {
		return "", fmt.Errorf("mapping %s uses {suffix} with non-prefix matching", ruleID)
	}
	rendered := strings.ReplaceAll(template, "{claim}", claim)
	rendered = strings.ReplaceAll(rendered, "{suffix}", suffix)
	rendered = strings.ReplaceAll(rendered, "{provider}", providerName)
	rendered = strings.Join(strings.Fields(rendered), " ")
	if rendered == "" {
		return "", fmt.Errorf("mapping %s rendered an empty org name", ruleID)
	}
	return rendered, nil
}

func findOrCreateOrgByName(ctx context.Context, db bun.IDB, userID uuid.UUID, orgName string, mapping models.OIDCGroupOrgMapping, claim, providerName string) (uuid.UUID, error) {
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

func recreateMissingOrg(ctx context.Context, db bun.IDB, userID, orgID uuid.UUID, orgName string, mapping models.OIDCGroupOrgMapping, claim, providerName string) (uuid.UUID, error) {
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
	case models.OrgRoleOwner:
		return models.OrgRoleAdmin
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
func upsertOIDCMembership(ctx context.Context, db bun.IDB, userID, orgID uuid.UUID, role, providerName string, mappingID *uuid.UUID) error {
	now := time.Now()
	updateExisting := func() (int64, error) {
		result, err := db.NewUpdate().Model((*models.OrgMember)(nil)).
			Set("role = ?", role).
			Set("oidc_provider = ?", providerName).
			Set("oidc_mapping_id = ?", mappingID).
			Set("updated_at = ?", now).
			Where("org_id = ? AND user_id = ? AND oidc_synced = true", orgID, userID).
			Exec(ctx)
		if err != nil {
			return 0, err
		}
		return result.RowsAffected()
	}

	updatedRows, err := updateExisting()
	if err != nil {
		return err
	}
	if updatedRows > 0 {
		return nil
	}

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
	insertResult, err := db.NewInsert().Model(&member).
		On("CONFLICT (org_id, user_id) DO NOTHING").
		Exec(ctx)
	if err != nil {
		return err
	}
	insertedRows, err := insertResult.RowsAffected()
	if err != nil {
		return err
	}
	if insertedRows > 0 {
		return nil
	}

	updatedRows, err = updateExisting()
	if err != nil {
		return err
	}
	if updatedRows > 0 {
		return nil
	}

	return nil
}

func resolveFinalOIDCRole(overrides []models.OIDCOrgRoleOverride, desired desiredOIDCMembership, groups, roles []string, providerName string) string {
	finalRole := normalizeMappingRole(desired.Role)
	matchedOverride := false
	for _, override := range overrides {
		if !roleOverrideTargetsDesired(override, desired, providerName) {
			continue
		}
		if !roleOverrideMatchesAnyClaim(override, groups, roles) {
			continue
		}
		overrideRole := normalizeMappingRole(override.Role)
		if !matchedOverride || rolePriority(overrideRole) > rolePriority(finalRole) {
			finalRole = overrideRole
			matchedOverride = true
		}
	}
	return finalRole
}

func roleOverrideTargetsDesired(override models.OIDCOrgRoleOverride, desired desiredOIDCMembership, providerName string) bool {
	switch override.TargetType {
	case "rendered_name":
		claims := []string{desired.Claim}
		for _, claim := range claims {
			matched, suffix := mappingMatches(models.OIDCGroupOrgMapping{MatchType: override.MatchType, MatchValue: override.MatchValue}, claim)
			if !matched {
				continue
			}
			rendered, err := renderOIDCNameTemplate(override.ID.String(), override.MatchType, override.OrgNameTemplate, claim, suffix, providerName)
			if err == nil && rendered == desired.OrgName {
				return true
			}
		}
		return false
	case "org_id", "":
		return override.OrgID != nil && desired.OrgID != nil && *override.OrgID == *desired.OrgID
	default:
		return false
	}
}

func roleOverrideMatchesAnyClaim(override models.OIDCOrgRoleOverride, groups, roles []string) bool {
	claims := groups
	if override.ClaimType == "role" {
		claims = roles
	}
	for _, claim := range claims {
		matched, _ := mappingMatches(models.OIDCGroupOrgMapping{MatchType: override.MatchType, MatchValue: override.MatchValue}, claim)
		if matched {
			return true
		}
	}
	return false
}

func ensureDesiredMembership(ctx context.Context, db *bun.DB, userID uuid.UUID, providerName string, desired desiredOIDCMembership) (uuid.UUID, error) {
	if desired.OrgID != nil && !desired.RequiresCreate {
		if err := upsertOIDCMembership(ctx, db, userID, *desired.OrgID, desired.Role, providerName, desired.MappingID); err != nil {
			return uuid.Nil, err
		}
		return *desired.OrgID, nil
	}

	var ensuredOrgID uuid.UUID
	if err := db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		var err error
		switch desired.Mapping.ProvisioningMode {
		case "create_org":
			ensuredOrgID, err = findOrCreateOrgByName(ctx, tx, userID, desired.OrgName, desired.Mapping, desired.Claim, providerName)
		case "existing_org", "":
			if desired.Mapping.OrgID == nil {
				return fmt.Errorf("existing_org mapping %s is missing org_id", desired.Mapping.ID)
			}
			ensuredOrgID, err = recreateMissingOrg(ctx, tx, userID, *desired.Mapping.OrgID, desired.OrgName, desired.Mapping, desired.Claim, providerName)
		default:
			return fmt.Errorf("unsupported provisioning mode %q", desired.Mapping.ProvisioningMode)
		}
		if err != nil {
			return err
		}
		if err := upsertOIDCMembership(ctx, tx, userID, ensuredOrgID, desired.Role, providerName, desired.MappingID); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return uuid.Nil, err
	}
	return ensuredOrgID, nil
}
