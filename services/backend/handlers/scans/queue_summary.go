package scans

import (
	"net/http"
	"time"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

// QueueSummary describes the visible workspace activity and the shared worker capacity.
type QueueSummary struct {
	QueuedInJustScan   int        `json:"queued_in_justscan"`
	Active             int        `json:"active"`
	WorkerCapacity     int        `json:"worker_capacity"`
	QueueDepth         int        `json:"queue_depth"`
	QueueCapacity      int        `json:"queue_capacity"`
	ActiveWorkers      int        `json:"active_workers"`
	WorkerUtilization  float64    `json:"worker_utilization"`
	OldestQueuedAt     *time.Time `json:"oldest_queued_at,omitempty"`
	OldestQueuedLagSec float64    `json:"oldest_queued_lag_seconds"`
}

// GetQueueSummary returns workspace-scoped scan activity. Instance-wide queue
// and worker metrics are only included for administrators; regular users see
// the durable count for their own queued scans and never another workspace's
// activity.
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
			QueuedInJustScan int        `bun:"queued_in_justscan"`
			Active           int        `bun:"active"`
			OldestQueuedAt   *time.Time `bun:"oldest_queued_at"`
		}
		query := `
SELECT
    COUNT(*) FILTER (WHERE s.status = ? AND s.current_step = ?) AS queued_in_justscan,
    COUNT(*) FILTER (WHERE s.status = ?) AS active,
    MIN(s.created_at) FILTER (WHERE s.status = ? AND s.current_step = ?) AS oldest_queued_at
FROM scans AS s
WHERE ` + ownershipWhere + ` AND ` + scopeWhere
		queryArgs := append([]interface{}{}, args[:3]...)
		queryArgs = append(queryArgs, models.ScanStatusPending, models.ScanStepQueued)
		queryArgs = append(queryArgs, args[3:]...)
		if err := db.NewRaw(query, queryArgs...).Scan(c.Request.Context(), &counts); err != nil {
			_ = c.Error(err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scan queue summary"})
			return
		}

		queue := scanner.GetQueueStats()
		queueDepth := counts.QueuedInJustScan
		queueCapacity := 0
		activeWorkers := 0
		workerUtilization := 0.0
		if isAdmin {
			queueDepth = queue.Depth
			queueCapacity = queue.Capacity
			activeWorkers = queue.ActiveWorkers
			workerUtilization = queue.WorkerUtilization
		}
		summary := QueueSummary{
			QueuedInJustScan:  counts.QueuedInJustScan,
			Active:            counts.Active,
			WorkerCapacity:    scanner.WorkerConcurrency(),
			QueueDepth:        queueDepth,
			QueueCapacity:     queueCapacity,
			ActiveWorkers:     activeWorkers,
			WorkerUtilization: workerUtilization,
			OldestQueuedAt:    counts.OldestQueuedAt,
		}
		if counts.OldestQueuedAt != nil {
			summary.OldestQueuedLagSec = time.Since(counts.OldestQueuedAt.UTC()).Seconds()
			if summary.OldestQueuedLagSec < 0 {
				summary.OldestQueuedLagSec = 0
			}
		}
		c.JSON(http.StatusOK, summary)
	}
}
