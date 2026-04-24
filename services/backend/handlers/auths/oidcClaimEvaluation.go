package auths

import (
	"context"
	"fmt"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type OIDCClaimSyncPreview struct {
	ProviderName              string                    `json:"provider_name"`
	InputGroups               []string                  `json:"input_groups"`
	InputRoles                []string                  `json:"input_roles"`
	ProviderFilteredGroups    []string                  `json:"provider_filtered_groups"`
	ProviderFilteredOutGroups []string                  `json:"provider_filtered_out_groups"`
	EffectiveGroups           []string                  `json:"effective_groups"`
	EffectiveRoles            []string                  `json:"effective_roles"`
	BlockedGroups             []string                  `json:"blocked_groups"`
	BlockedRoles              []string                  `json:"blocked_roles"`
	MatchedRoutes             []OIDCClaimSyncRoute      `json:"matched_routes"`
	FinalMemberships          []OIDCClaimSyncMembership `json:"final_memberships"`
}

type OIDCClaimSyncRoute struct {
	MappingID          uuid.UUID  `json:"mapping_id"`
	Effect             string     `json:"effect"`
	ClaimType          string     `json:"claim_type"`
	MatchType          string     `json:"match_type"`
	MatchValue         string     `json:"match_value"`
	Claim              string     `json:"claim"`
	Suffix             string     `json:"suffix,omitempty"`
	ProvisioningMode   string     `json:"provisioning_mode"`
	OrgID              *uuid.UUID `json:"org_id,omitempty"`
	OrgName            string     `json:"org_name,omitempty"`
	BaseRole           string     `json:"base_role,omitempty"`
	FinalRole          string     `json:"final_role,omitempty"`
	RequiresCreate     bool       `json:"requires_create"`
	Status             string     `json:"status"`
	Reason             string     `json:"reason,omitempty"`
	OverrideApplied    bool       `json:"override_applied"`
	RemoveOnUnsync     bool       `json:"remove_on_unsync"`
	RecreateMissingOrg bool       `json:"recreate_missing_org"`
}

type OIDCClaimSyncMembership struct {
	MappingID        uuid.UUID  `json:"mapping_id"`
	OrgID            *uuid.UUID `json:"org_id,omitempty"`
	OrgName          string     `json:"org_name"`
	Claim            string     `json:"claim"`
	Suffix           string     `json:"suffix,omitempty"`
	BaseRole         string     `json:"base_role"`
	FinalRole        string     `json:"final_role"`
	RequiresCreate   bool       `json:"requires_create"`
	ProvisioningMode string     `json:"provisioning_mode"`
	RemoveOnUnsync   bool       `json:"remove_on_unsync"`
	OverrideApplied  bool       `json:"override_applied"`
}

type oidcEvaluationResult struct {
	Preview            OIDCClaimSyncPreview
	DesiredMemberships []desiredOIDCMembership
	Mappings           []models.OIDCGroupOrgMapping
	MappingByID        map[uuid.UUID]models.OIDCGroupOrgMapping
}

func EvaluateOIDCClaimSync(ctx context.Context, db *bun.DB, providerName string, groups, roles []string) (*OIDCClaimSyncPreview, error) {
	result, err := evaluateOIDCClaimSync(ctx, db, providerName, groups, roles)
	if err != nil {
		return nil, err
	}
	return &result.Preview, nil
}

func evaluateOIDCClaimSync(ctx context.Context, db *bun.DB, providerName string, groups, roles []string) (*oidcEvaluationResult, error) {
	var provider models.OIDCProvider
	if err := db.NewSelect().Model(&provider).Where("name = ?", providerName).Scan(ctx); err != nil {
		return nil, fmt.Errorf("provider %q not found", providerName)
	}

	providerFilteredGroups := filterProviderGroups(provider, groups)
	providerFilteredOutGroups := subtractClaims(groups, providerFilteredGroups)

	var mappings []models.OIDCGroupOrgMapping
	if err := db.NewSelect().Model(&mappings).Where("provider_name = ?", providerName).Scan(ctx); err != nil {
		return nil, fmt.Errorf("failed to load claim mappings for provider %q: %w", providerName, err)
	}

	var overrides []models.OIDCOrgRoleOverride
	if err := db.NewSelect().Model(&overrides).Where("provider_name = ?", providerName).OrderExpr("created_at ASC").Scan(ctx); err != nil {
		return nil, fmt.Errorf("failed to load role overrides for provider %q: %w", providerName, err)
	}

	blockers := buildClaimBlockers(mappings)
	blockedGroups := blockedClaimsForType("group", providerFilteredGroups, blockers)
	blockedRoles := blockedClaimsForType("role", roles, blockers)
	filteredGroups := filterBlockedClaims("group", providerFilteredGroups, blockers)
	filteredRoles := filterBlockedClaims("role", roles, blockers)

	preview := OIDCClaimSyncPreview{
		ProviderName:              providerName,
		InputGroups:               cloneStringSlice(groups),
		InputRoles:                cloneStringSlice(roles),
		ProviderFilteredGroups:    cloneStringSlice(providerFilteredGroups),
		ProviderFilteredOutGroups: cloneStringSlice(providerFilteredOutGroups),
		EffectiveGroups:           cloneStringSlice(filteredGroups),
		EffectiveRoles:            cloneStringSlice(filteredRoles),
		BlockedGroups:             cloneStringSlice(blockedGroups),
		BlockedRoles:              cloneStringSlice(blockedRoles),
		MatchedRoutes:             []OIDCClaimSyncRoute{},
		FinalMemberships:          []OIDCClaimSyncMembership{},
	}

	mappingByID := make(map[uuid.UUID]models.OIDCGroupOrgMapping, len(mappings))
	shouldBeMember := make(map[string]desiredOIDCMembership)
	selectedRouteIndex := make(map[string]int)

	for _, mapping := range mappings {
		mappingByID[mapping.ID] = mapping
		if mapping.Effect == "exclude" {
			continue
		}
		for _, claim := range claimsForMapping(mapping, filteredGroups, filteredRoles) {
			matched, suffix := mappingMatches(mapping, claim)
			if !matched {
				continue
			}

			route := OIDCClaimSyncRoute{
				MappingID:          mapping.ID,
				Effect:             mapping.Effect,
				ClaimType:          mapping.ClaimType,
				MatchType:          mapping.MatchType,
				MatchValue:         mapping.MatchValue,
				Claim:              claim,
				Suffix:             suffix,
				ProvisioningMode:   mapping.ProvisioningMode,
				BaseRole:           resolveMappingBaseRole(mapping),
				RemoveOnUnsync:     mapping.RemoveOnUnsync,
				RecreateMissingOrg: mapping.RecreateMissingOrg,
				Status:             "matched",
			}

			candidate, err := resolveRouteCandidate(ctx, db, uuid.Nil, providerName, mapping, claim, suffix)
			if err != nil {
				route.Status = "error"
				route.Reason = err.Error()
				preview.MatchedRoutes = append(preview.MatchedRoutes, route)
				continue
			}
			if candidate == nil {
				route.Status = "skipped"
				route.Reason = "no target org resolved"
				preview.MatchedRoutes = append(preview.MatchedRoutes, route)
				continue
			}

			route.OrgID = candidate.OrgID
			route.OrgName = candidate.OrgName
			route.RequiresCreate = candidate.RequiresCreate

			if !derivedOrgAllowed(provider, candidate.OrgName) {
				route.Status = "blocked_derived_org"
				route.Reason = "derived org filtered by provider"
				preview.MatchedRoutes = append(preview.MatchedRoutes, route)
				continue
			}

			desired := desiredOIDCMembership{
				OrgID:          candidate.OrgID,
				OrgName:        candidate.OrgName,
				Role:           candidate.BaseRole,
				MappingID:      pointerToUUID(mapping.ID),
				RemoveOnUnsync: mapping.RemoveOnUnsync,
				Mapping:        mapping,
				Claim:          claim,
				Suffix:         suffix,
				RequiresCreate: candidate.RequiresCreate,
			}

			routeIndex := len(preview.MatchedRoutes)
			route.Status = "selected"
			preview.MatchedRoutes = append(preview.MatchedRoutes, route)

			existing, exists := shouldBeMember[candidate.OrgKey]
			if !exists {
				shouldBeMember[candidate.OrgKey] = desired
				selectedRouteIndex[candidate.OrgKey] = routeIndex
				continue
			}

			if rolePriority(desired.Role) > rolePriority(existing.Role) {
				if previousIndex, ok := selectedRouteIndex[candidate.OrgKey]; ok {
					preview.MatchedRoutes[previousIndex].Status = "shadowed"
					preview.MatchedRoutes[previousIndex].Reason = "replaced by higher-priority role for the same org"
				}
				shouldBeMember[candidate.OrgKey] = desired
				selectedRouteIndex[candidate.OrgKey] = routeIndex
				continue
			}

			preview.MatchedRoutes[routeIndex].Status = "shadowed"
			preview.MatchedRoutes[routeIndex].Reason = "lower-priority role for the same org"
		}
	}

	desiredMemberships := make([]desiredOIDCMembership, 0, len(shouldBeMember))
	for orgKey, desired := range shouldBeMember {
		baseRole := desired.Role
		finalRole := resolveFinalOIDCRole(overrides, desired, filteredGroups, filteredRoles, providerName)
		desired.Role = finalRole
		desiredMemberships = append(desiredMemberships, desired)
		if routeIndex, ok := selectedRouteIndex[orgKey]; ok {
			preview.MatchedRoutes[routeIndex].FinalRole = finalRole
			preview.MatchedRoutes[routeIndex].OverrideApplied = finalRole != baseRole
		}
		preview.FinalMemberships = append(preview.FinalMemberships, OIDCClaimSyncMembership{
			MappingID:        desired.Mapping.ID,
			OrgID:            desired.OrgID,
			OrgName:          desired.OrgName,
			Claim:            desired.Claim,
			Suffix:           desired.Suffix,
			BaseRole:         baseRole,
			FinalRole:        finalRole,
			RequiresCreate:   desired.RequiresCreate,
			ProvisioningMode: desired.Mapping.ProvisioningMode,
			RemoveOnUnsync:   desired.RemoveOnUnsync,
			OverrideApplied:  finalRole != baseRole,
		})
	}

	return &oidcEvaluationResult{
		Preview:            preview,
		DesiredMemberships: desiredMemberships,
		Mappings:           mappings,
		MappingByID:        mappingByID,
	}, nil
}

func blockedClaimsForType(claimType string, claims []string, blockers oidcClaimBlockers) []string {
	if len(claims) == 0 {
		return nil
	}
	blocked := make([]string, 0, len(claims))
	for _, claim := range claims {
		if claimBlocked(claimType, claim, blockers) {
			blocked = append(blocked, claim)
		}
	}
	return blocked
}

func subtractClaims(original, remaining []string) []string {
	if len(original) == 0 {
		return nil
	}
	counts := make(map[string]int, len(remaining))
	for _, claim := range remaining {
		counts[claim]++
	}
	removed := make([]string, 0, len(original))
	for _, claim := range original {
		if counts[claim] > 0 {
			counts[claim]--
			continue
		}
		removed = append(removed, claim)
	}
	return removed
}

func cloneStringSlice(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	cloned := make([]string, len(values))
	copy(cloned, values)
	return cloned
}

func resolveMappingBaseRole(mapping models.OIDCGroupOrgMapping) string {
	baseRole := normalizeMappingRole(mapping.Role)
	if mapping.ProvisioningMode == "create_org" && mapping.Role == "" {
		return models.OrgRoleAdmin
	}
	return baseRole
}
