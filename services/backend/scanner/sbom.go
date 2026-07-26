package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

const (
	SBOMSourceTrivy         = "trivy"
	SBOMSourceXray          = "xray"
	SBOMSourceTrivyFallback = "trivy_fallback"
)

// PersistSBOMDocument stores the original CycloneDX document, components, and
// dependency edges together so the UI never has to infer a graph from names.
func PersistSBOMDocument(ctx context.Context, db *bun.DB, scanID uuid.UUID, sbom *TrivySBOMOutput, source, diagnostic string) error {
	if sbom == nil {
		return fmt.Errorf("SBOM document is required")
	}
	if source == "" {
		source = SBOMSourceTrivy
	}
	raw, err := sbomJSONObject(sbom)
	if err != nil {
		return err
	}

	documentID := uuid.New()
	components := make([]models.SBOMComponent, 0, len(sbom.Components)+1)
	byRef := make(map[string]uuid.UUID, len(sbom.Components)+1)
	rootRef := ""
	if root := sbom.Metadata.Component; root != nil {
		rootRef = componentRef(*root)
		if rootRef != "" {
			component := componentModel(*root, scanID, documentID)
			component.ID = uuid.New()
			component.IsRoot = true
			depth := 0
			component.Depth = &depth
			components = append(components, component)
			byRef[rootRef] = component.ID
		}
	}
	for _, item := range sbom.Components {
		ref := componentRef(item)
		if ref == "" || byRef[ref] != uuid.Nil {
			continue
		}
		component := componentModel(item, scanID, documentID)
		component.ID = uuid.New()
		components = append(components, component)
		byRef[ref] = component.ID
	}

	warnings := []string{}
	edges := make([]models.SBOMDependency, 0)
	for _, dependency := range sbom.Dependencies {
		fromRef := strings.TrimSpace(dependency.Ref)
		fromID, exists := byRef[fromRef]
		if !exists {
			warnings = append(warnings, "Dependency source is absent from components: "+fromRef)
			continue
		}
		for _, targetRef := range dependency.DependsOn {
			targetRef = strings.TrimSpace(targetRef)
			toID, exists := byRef[targetRef]
			if !exists {
				warnings = append(warnings, "Dependency target is absent from components: "+targetRef)
				continue
			}
			edges = append(edges, models.SBOMDependency{ID: uuid.New(), DocumentID: documentID, FromComponentID: fromID, ToComponentID: toID})
		}
	}
	setSBOMDepths(components, edges)
	document := models.SBOMDocument{
		ID: documentID, ScanID: scanID, Source: source, Status: "available", Format: "cyclonedx-json",
		SpecVersion: sbom.SpecVersion, RootRef: rootRef, ComponentCount: len(components), DependencyCount: len(edges),
		// A document without dependency records may still be a valid CycloneDX
		// document, but it cannot support a dependable dependency path.
		GraphComplete: rootRef != "" && len(sbom.Dependencies) > 0 && len(warnings) == 0, Warnings: uniqueSBOMStrings(warnings), Diagnostic: diagnostic, RawDocument: raw,
	}

	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.NewDelete().Model((*models.SBOMDocument)(nil)).Where("scan_id = ?", scanID).Exec(ctx); err != nil {
			return err
		}
		if _, err := tx.NewDelete().Model((*models.SBOMComponent)(nil)).Where("scan_id = ?", scanID).Exec(ctx); err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(&document).Exec(ctx); err != nil {
			return err
		}
		if len(components) > 0 {
			if _, err := tx.NewInsert().Model(&components).Exec(ctx); err != nil {
				return err
			}
		}
		if len(edges) > 0 {
			if _, err := tx.NewInsert().Model(&edges).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}

func componentModel(item TrivySBOMComp, scanID, documentID uuid.UUID) models.SBOMComponent {
	licenses := make([]string, 0, len(item.Licenses))
	for _, license := range item.Licenses {
		if license.License != nil {
			if value := firstSBOMNonEmpty(license.License.ID, license.License.Name); value != "" {
				licenses = append(licenses, value)
			}
		}
	}
	hashes := make([]models.JSONObject, 0, len(item.Hashes))
	for _, hash := range item.Hashes {
		if hash.Alg != "" || hash.Content != "" {
			hashes = append(hashes, models.JSONObject{"alg": hash.Alg, "content": hash.Content})
		}
	}
	properties := make([]models.JSONObject, 0, len(item.Properties))
	for _, property := range item.Properties {
		if property.Name != "" {
			properties = append(properties, models.JSONObject{"name": property.Name, "value": property.Value})
		}
	}
	supplier := ""
	if item.Supplier != nil {
		supplier = item.Supplier.Name
	}
	return models.SBOMComponent{
		ScanID: scanID, DocumentID: &documentID, BOMRef: componentRef(item), Group: item.Group,
		Name: item.Name, Version: item.Version, Type: item.Type, Scope: item.Scope, Ecosystem: componentEcosystem(item),
		PackageURL: item.PURL, License: firstSBOMString(licenses), Licenses: licenses, Hashes: hashes, Properties: properties, Supplier: supplier,
	}
}

func componentRef(component TrivySBOMComp) string {
	return firstSBOMNonEmpty(component.BOMRef, component.PURL)
}

func componentEcosystem(component TrivySBOMComp) string {
	purl := strings.TrimPrefix(strings.TrimSpace(component.PURL), "pkg:")
	if index := strings.IndexByte(purl, '/'); index > 0 {
		return purl[:index]
	}
	for _, property := range component.Properties {
		if strings.EqualFold(property.Name, "aquasecurity:trivy:PkgType") {
			return property.Value
		}
	}
	return ""
}

func firstSBOMNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func firstSBOMString(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func uniqueSBOMStrings(values []string) []string {
	seen := map[string]bool{}
	results := []string{}
	for _, value := range values {
		if value != "" && !seen[value] {
			seen[value] = true
			results = append(results, value)
		}
	}
	return results
}

func sbomJSONObject(sbom *TrivySBOMOutput) (models.JSONObject, error) {
	raw, err := json.Marshal(sbom)
	if err != nil {
		return nil, err
	}
	value := models.JSONObject{}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	return value, nil
}

func setSBOMDepths(components []models.SBOMComponent, edges []models.SBOMDependency) {
	children := map[uuid.UUID][]uuid.UUID{}
	byID := map[uuid.UUID]*models.SBOMComponent{}
	queue := []uuid.UUID{}
	for index := range components {
		byID[components[index].ID] = &components[index]
		if components[index].IsRoot {
			queue = append(queue, components[index].ID)
		}
	}
	for _, edge := range edges {
		children[edge.FromComponentID] = append(children[edge.FromComponentID], edge.ToComponentID)
	}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		component := byID[current]
		if component == nil || component.Depth == nil {
			continue
		}
		nextDepth := *component.Depth + 1
		for _, childID := range children[current] {
			child := byID[childID]
			if child == nil || (child.Depth != nil && *child.Depth <= nextDepth) {
				continue
			}
			depth := nextDepth
			child.Depth = &depth
			queue = append(queue, childID)
		}
	}
}

// LinkVulnerabilitiesToSBOM is deliberately conservative: duplicate package
// names/versions are not linked without a package URL or scanner identifier.
func LinkVulnerabilitiesToSBOM(ctx context.Context, db *bun.DB, scanID uuid.UUID) error {
	var components []models.SBOMComponent
	if err := db.NewSelect().Model(&components).Where("scan_id = ?", scanID).Scan(ctx); err != nil {
		return err
	}
	var vulnerabilities []models.Vulnerability
	if err := db.NewSelect().Model(&vulnerabilities).Where("scan_id = ?", scanID).Scan(ctx); err != nil {
		return err
	}
	byNameVersion := map[string][]models.SBOMComponent{}
	for _, component := range components {
		if !component.IsRoot {
			byNameVersion[strings.ToLower(component.Name)+"|"+component.Version] = append(byNameVersion[strings.ToLower(component.Name)+"|"+component.Version], component)
		}
	}
	links := []models.VulnerabilityComponentLink{}
	for _, vulnerability := range vulnerabilities {
		candidates := byNameVersion[strings.ToLower(vulnerability.PkgName)+"|"+vulnerability.InstalledVersion]
		if len(candidates) != 1 {
			continue
		}
		// The current normalized vulnerability record does not retain Trivy's
		// package identifier. A unique name/version match is useful evidence, but
		// must remain visibly inferred even if the SBOM component has a PURL.
		links = append(links, models.VulnerabilityComponentLink{ID: uuid.New(), VulnerabilityID: vulnerability.ID, ComponentID: candidates[0].ID, MatchMethod: "name_version", Confidence: "inferred"})
	}
	if len(links) == 0 {
		return nil
	}
	_, err := db.NewInsert().Model(&links).On("CONFLICT (vulnerability_id, component_id) DO UPDATE").Set("match_method = EXCLUDED.match_method").Set("confidence = EXCLUDED.confidence").Exec(ctx)
	return err
}
