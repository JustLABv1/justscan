package scans

import (
	"net/http"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

// QueueSummary describes the visible workspace activity and the shared worker capacity.
type QueueSummary struct {
	QueuedInJustScan int `json:"queued_in_justscan"`
	Active           int `json:"active"`
	WorkerCapacity   int `json:"worker_capacity"`
}

// GetQueueSummary returns workspace-scoped scan activity without exposing
// queue depth or worker activity from other workspaces.
func GetQueueSummary(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}

		ownershipWhere, ownershipArgs := scanOwnershipWhere(userID, isAdmin, accessibleOrgIDs, "s")
		scopeWhere, scopeArgs := scanScopeWhere(c, userID, "s")
		args := []interface{}{models.ScanStatusPending, models.ScanStepQueued, models.ScanStatusRunning}
		args = append(args, ownershipArgs...)
		args = append(args, scopeArgs...)

		var counts struct {
			QueuedInJustScan int `bun:"queued_in_justscan"`
			Active           int `bun:"active"`
		}
		query := `
SELECT
    COUNT(*) FILTER (WHERE s.status = ? AND s.current_step = ?) AS queued_in_justscan,
    COUNT(*) FILTER (WHERE s.status = ?) AS active
FROM scans AS s
WHERE ` + ownershipWhere + ` AND ` + scopeWhere
		if err := db.NewRaw(query, args...).Scan(c.Request.Context(), &counts); err != nil {
			_ = c.Error(err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan queue summary"})
			return
		}

		summary := QueueSummary{
			QueuedInJustScan: counts.QueuedInJustScan,
			Active:           counts.Active,
			WorkerCapacity:   scanner.WorkerConcurrency(),
		}
		c.JSON(http.StatusOK, summary)
	}
}
