package shared

import (
	"net/http"

	"justscan-backend/handlers/scans"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func GetSharedSBOM(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scan := getScanByShareToken(c, db)
		if scan == nil {
			return
		}
		var components []models.SBOMComponent
		query := db.NewSelect().Model(&components).Where("scan_id = ?", scan.ID).OrderExpr("is_root DESC, name, version")
		if name := c.Query("name"); name != "" {
			query = query.Where("name ILIKE ?", "%"+name+"%")
		}
		if err := query.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load SBOM"})
			return
		}
		if err := scans.AttachSBOMVulnerabilityCounts(c.Request.Context(), db, components); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load SBOM vulnerability links"})
			return
		}
		document, _ := scans.LoadSBOMDocument(c.Request.Context(), db, scan.ID)
		c.JSON(http.StatusOK, gin.H{"data": components, "total": len(components), "document": document})
	}
}

func GetSharedSBOMGraph(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scan := getScanByShareToken(c, db)
		if scan == nil {
			return
		}
		graph, err := scans.LoadSBOMGraph(c.Request.Context(), db, scan.ID, c.Query("focus"), sharedGraphLimit(c.Query("limit")))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load SBOM graph"})
			return
		}
		c.JSON(http.StatusOK, graph)
	}
}

func GetSharedSBOMComponent(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scan := getScanByShareToken(c, db)
		if scan == nil {
			return
		}
		componentID, err := uuid.Parse(c.Param("componentId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid component ID"})
			return
		}
		component, err := scans.LoadSBOMComponent(c.Request.Context(), db, scan.ID, componentID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "SBOM component not found"})
			return
		}
		c.JSON(http.StatusOK, component)
	}
}

func DownloadSharedSBOM(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scan := getScanByShareToken(c, db)
		if scan == nil {
			return
		}
		document, err := scans.LoadSBOMDocument(c.Request.Context(), db, scan.ID)
		if err != nil || len(document.RawDocument) == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "SBOM document is not available; re-scan this artifact to generate it"})
			return
		}
		c.Header("Content-Disposition", "attachment; filename=justscan-sbom-"+scan.ID.String()+".cdx.json")
		c.JSON(http.StatusOK, document.RawDocument)
	}
}

func sharedGraphLimit(value string) int {
	if value == "" {
		return 250
	}
	return 250
}
