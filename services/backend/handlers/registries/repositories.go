package registries

import (
	"net/http"
	"sort"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ListArtifactoryRepositories(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		registryID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry ID"})
			return
		}

		registry, _, _, ok := authz.LoadAccessibleRegistry(c, db, registryID)
		if !ok {
			return
		}
		if registry.ScanProvider != models.ScanProviderArtifactoryXray {
			c.JSON(http.StatusConflict, gin.H{"error": "artifactory repositories are only available for Artifactory Xray registries"})
			return
		}

		client, err := scanner.NewRegistryXrayTestClient(registry)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		repositories, err := client.ListDockerRepositories(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		sort.SliceStable(repositories, func(i, j int) bool {
			return repositories[i].Key < repositories[j].Key
		})

		c.JSON(http.StatusOK, gin.H{"data": repositories})
	}
}
