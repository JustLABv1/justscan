package scans

import (
	"net/http"

	"justscan-backend/compliance"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// GetIntelligencePolicyImpact returns the current intelligence overlay for
// policies attached to one authorized, completed scan. The original
// compliance result is never rewritten by this endpoint.
func GetIntelligencePolicyImpact(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		_, userID, isAdmin, ok := LoadAuthorizedScan(c, db, scanID)
		if !ok {
			return
		}

		visibleOrgIDs, err := compliance.LoadVisibleOrgIDs(c.Request.Context(), db, userID, isAdmin)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve policy visibility"})
			return
		}

		response, err := compliance.EvaluateScanIntelligencePolicyImpacts(
			c.Request.Context(),
			db,
			scanID,
			visibleOrgIDs,
			isAdmin,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to evaluate intelligence policy impact"})
			return
		}

		c.JSON(http.StatusOK, response)
	}
}
