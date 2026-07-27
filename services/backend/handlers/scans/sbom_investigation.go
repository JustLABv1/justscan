package scans

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type SBOMGraphResponse struct {
	Document  *models.SBOMDocument    `json:"document,omitempty"`
	Nodes     []models.SBOMComponent  `json:"nodes"`
	Edges     []models.SBOMDependency `json:"edges"`
	Truncated bool                    `json:"truncated"`
}

func GetSBOMGraph(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		if _, _, _, ok := LoadAuthorizedScan(c, db, scanID); !ok {
			return
		}
		graph, err := LoadSBOMGraph(c.Request.Context(), db, scanID, c.Query("focus"), graphLimit(c.Query("limit")))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load SBOM graph"})
			return
		}
		c.JSON(http.StatusOK, graph)
	}
}

func GetSBOMComponent(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		if _, _, _, ok := LoadAuthorizedScan(c, db, scanID); !ok {
			return
		}
		componentID, err := uuid.Parse(c.Param("componentId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid component ID"})
			return
		}
		component, err := LoadSBOMComponent(c.Request.Context(), db, scanID, componentID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "SBOM component not found"})
			return
		}
		c.JSON(http.StatusOK, component)
	}
}

func DownloadSBOM(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		if _, _, _, ok := LoadAuthorizedScan(c, db, scanID); !ok {
			return
		}
		document, err := LoadSBOMDocument(c.Request.Context(), db, scanID)
		if err != nil || len(document.RawDocument) == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "SBOM document is not available; re-scan this artifact to generate it"})
			return
		}
		c.Header("Content-Disposition", "attachment; filename=justscan-sbom-"+scanID.String()+".cdx.json")
		c.JSON(http.StatusOK, document.RawDocument)
	}
}

func LoadSBOMDocument(ctx context.Context, db *bun.DB, scanID uuid.UUID) (*models.SBOMDocument, error) {
	document := &models.SBOMDocument{}
	if err := db.NewSelect().Model(document).Where("scan_id = ?", scanID).Scan(ctx); err != nil {
		return nil, err
	}
	return document, nil
}

func LoadSBOMGraph(ctx context.Context, db *bun.DB, scanID uuid.UUID, focus string, limit int) (*SBOMGraphResponse, error) {
	document, err := LoadSBOMDocument(ctx, db, scanID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	// Older scans have a package inventory but no persisted CycloneDX document.
	// Keep that inventory usable in the tree and package drawer while making no
	// claim that its dependency relationships are known.
	legacyInventory := err == sql.ErrNoRows
	components := make([]models.SBOMComponent, 0)
	query := db.NewSelect().Model(&components).Where("scan_id = ?", scanID).OrderExpr("is_root DESC, name, version").Limit(limit + 1)
	if focusID, err := uuid.Parse(focus); err == nil {
		query = query.Where("id = ? OR id IN (SELECT to_component_id FROM sbom_dependencies WHERE from_component_id = ?) OR id IN (SELECT from_component_id FROM sbom_dependencies WHERE to_component_id = ?)", focusID, focusID, focusID)
	}
	if err := query.Scan(ctx); err != nil {
		return nil, err
	}
	if err := AttachSBOMVulnerabilityCounts(ctx, db, components); err != nil {
		return nil, err
	}
	truncated := len(components) > limit
	if truncated {
		components = components[:limit]
	}
	ids := make([]uuid.UUID, 0, len(components))
	for _, component := range components {
		ids = append(ids, component.ID)
	}
	edges := make([]models.SBOMDependency, 0)
	if !legacyInventory && len(ids) > 0 {
		if err := db.NewSelect().Model(&edges).Where("document_id = ? AND from_component_id IN (?) AND to_component_id IN (?)", document.ID, bun.In(ids), bun.In(ids)).Scan(ctx); err != nil {
			return nil, err
		}
	}
	if legacyInventory {
		document = nil
	}
	return &SBOMGraphResponse{Document: document, Nodes: components, Edges: edges, Truncated: truncated}, nil
}

type SBOMComponentDetail struct {
	Component       models.SBOMComponent   `json:"component"`
	Dependencies    []models.SBOMComponent `json:"dependencies"`
	Dependents      []models.SBOMComponent `json:"dependents"`
	Vulnerabilities []models.Vulnerability `json:"vulnerabilities"`
}

func LoadSBOMComponent(ctx context.Context, db *bun.DB, scanID, componentID uuid.UUID) (*SBOMComponentDetail, error) {
	component := models.SBOMComponent{}
	if err := db.NewSelect().Model(&component).Where("id = ? AND scan_id = ?", componentID, scanID).Scan(ctx); err != nil {
		return nil, err
	}
	var dependencyIDs, dependentIDs []uuid.UUID
	if err := db.NewSelect().Model((*models.SBOMDependency)(nil)).ColumnExpr("to_component_id").Where("from_component_id = ?", componentID).Scan(ctx, &dependencyIDs); err != nil {
		return nil, err
	}
	if err := db.NewSelect().Model((*models.SBOMDependency)(nil)).ColumnExpr("from_component_id").Where("to_component_id = ?", componentID).Scan(ctx, &dependentIDs); err != nil {
		return nil, err
	}
	var dependencies, dependents []models.SBOMComponent
	if len(dependencyIDs) > 0 {
		if err := db.NewSelect().Model(&dependencies).Where("id IN (?)", bun.In(dependencyIDs)).OrderExpr("name, version").Scan(ctx); err != nil {
			return nil, err
		}
	}
	if len(dependentIDs) > 0 {
		if err := db.NewSelect().Model(&dependents).Where("id IN (?)", bun.In(dependentIDs)).OrderExpr("name, version").Scan(ctx); err != nil {
			return nil, err
		}
	}
	if err := AttachSBOMVulnerabilityCounts(ctx, db, append(append([]models.SBOMComponent{}, dependencies...), dependents...)); err != nil {
		return nil, err
	}
	var vulnerabilities []models.Vulnerability
	var vulnerabilityIDs []uuid.UUID
	if err := db.NewSelect().Model((*models.VulnerabilityComponentLink)(nil)).ColumnExpr("vulnerability_id").Where("component_id = ?", componentID).Scan(ctx, &vulnerabilityIDs); err != nil {
		return nil, err
	}
	if len(vulnerabilityIDs) > 0 {
		if err := db.NewSelect().Model(&vulnerabilities).Where("id IN (?)", bun.In(vulnerabilityIDs)).OrderExpr("cvss_score DESC").Scan(ctx); err != nil {
			return nil, err
		}
	}
	if err := AttachSBOMVulnerabilityCounts(ctx, db, []models.SBOMComponent{component}); err != nil {
		return nil, err
	}
	return &SBOMComponentDetail{Component: component, Dependencies: dependencies, Dependents: dependents, Vulnerabilities: vulnerabilities}, nil
}

// AttachSBOMVulnerabilityCounts keeps list and graph views honest without
// forcing the client to infer CVE ownership from package strings.
func AttachSBOMVulnerabilityCounts(ctx context.Context, db *bun.DB, components []models.SBOMComponent) error {
	if len(components) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(components))
	byID := make(map[uuid.UUID]*models.SBOMComponent, len(components))
	for index := range components {
		ids = append(ids, components[index].ID)
		byID[components[index].ID] = &components[index]
	}
	var rows []struct {
		ComponentID uuid.UUID `bun:"component_id"`
		Count       int       `bun:"count"`
	}
	if err := db.NewSelect().TableExpr("vulnerability_component_links").ColumnExpr("component_id, COUNT(*) AS count").Where("component_id IN (?)", bun.In(ids)).GroupExpr("component_id").Scan(ctx, &rows); err != nil {
		return err
	}
	for _, row := range rows {
		if component := byID[row.ComponentID]; component != nil {
			component.VulnerabilityCount = row.Count
		}
	}
	return nil
}

func graphLimit(value string) int {
	limit, err := strconv.Atoi(value)
	if err != nil || limit <= 0 {
		return 250
	}
	if limit > 1000 {
		return 1000
	}
	return limit
}
