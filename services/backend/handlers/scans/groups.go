package scans

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	workerjobs "justscan-backend/backgroundjobs"
	"justscan-backend/functions/audit"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

const scanDeletionBatchSize = 8

// DeleteScanImageGroup deletes every writable scan for an image in the active scope.
func DeleteScanImageGroup(db *bun.DB) gin.HandlerFunc {
	return deleteScanGroup(db, false)
}

// DeleteScanArtifactGroup deletes every writable scan for one image tag in the active scope.
func DeleteScanArtifactGroup(db *bun.DB) gin.HandlerFunc {
	return deleteScanGroup(db, true)
}

func deleteScanGroup(db *bun.DB, requireTag bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		imageName := strings.TrimSpace(c.Query("image"))
		if imageName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "image is required"})
			return
		}
		imageTag := strings.TrimSpace(c.Query("tag"))
		if requireTag && imageTag == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "tag is required"})
			return
		}

		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		// Bun aliases models by their singular name ("scan"), so the scope predicate
		// must use that alias when this query is organization-scoped.
		scopeWhere, scopeArgs := scanScopeWhere(c, userID, "scan")
		var scans []models.Scan
		query := db.NewSelect().Model(&scans).Where("image_name = ?", imageName).Where(scopeWhere, scopeArgs...)
		if requireTag {
			query = query.Where("image_tag = ?", imageTag)
		}
		if err := query.OrderExpr("created_at ASC, id ASC").Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load scans"})
			return
		}
		if len(scans) == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "scan group not found"})
			return
		}

		scanIDs := make([]uuid.UUID, 0, len(scans))
		for index := range scans {
			if !canWriteScan(c.Request.Context(), db, &scans[index], userID, isAdmin) {
				c.JSON(http.StatusForbidden, gin.H{"error": "not allowed to delete this scan group"})
				return
			}
			scanIDs = append(scanIDs, scans[index].ID)
		}

		scopeType, scopeRef := scanDeletionJobScope(c, userID)
		scopeLabel := strings.TrimSpace(c.Query("scope"))
		if scopeLabel == "" {
			scopeLabel = "all"
		}
		auditTarget := imageName
		if requireTag {
			auditTarget += ":" + imageTag
		}
		job, err := workerjobs.Enqueue(c.Request.Context(), db, workerjobs.EnqueueRequest{
			UserID:        userID,
			ScopeType:     scopeType,
			ScopeRef:      scopeRef,
			Type:          models.BackgroundJobTypeScanGroupDeletion,
			Title:         "Delete scan group",
			Description:   fmt.Sprintf("Delete scans for %s", auditTarget),
			ProgressTotal: len(scanIDs),
			Phase:         "queued",
			Metadata: models.JSONObject{
				"image_name":  imageName,
				"image_tag":   imageTag,
				"require_tag": requireTag,
				"scope":       scopeLabel,
				"scan_count":  len(scanIDs),
			},
			Payload: models.JSONObject{
				"scan_ids":    scanIDStrings(scanIDs),
				"image_name":  imageName,
				"image_tag":   imageTag,
				"require_tag": requireTag,
			},
			DedupeKey: workerjobs.BuildDedupeKey(
				models.BackgroundJobTypeScanGroupDeletion,
				scopeType,
				scopeRef,
				imageName,
				imageTag,
			),
		})
		if err != nil {
			log.WithError(err).Errorf("enqueue scan group deletion failed for %s", imageName)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to queue scan group deletion"})
			return
		}

		c.JSON(http.StatusAccepted, gin.H{"job": job})
	}
}

func scanDeletionJobScope(c *gin.Context, userID uuid.UUID) (string, string) {
	scope := strings.TrimSpace(c.Query("scope"))
	if scope == "" || scope == "personal" {
		return models.BackgroundJobScopeUser, userID.String()
	}
	if orgID, err := uuid.Parse(scope); err == nil {
		return models.BackgroundJobScopeOrg, orgID.String()
	}
	// scanScopeWhere intentionally treats malformed scopes as unscoped for
	// backwards compatibility. Keep the durable job private in that case.
	return models.BackgroundJobScopeUser, userID.String()
}

func scanIDStrings(scanIDs []uuid.UUID) []string {
	result := make([]string, 0, len(scanIDs))
	for _, scanID := range scanIDs {
		result = append(result, scanID.String())
	}
	return result
}

// ProcessScanGroupDeletion executes one bounded batch at a time. The
// remaining ID list is persisted together with progress, so a worker restart
// can safely resume after any completed batch and missing rows are treated as
// already completed.
func ProcessScanGroupDeletion(ctx context.Context, db *bun.DB, job *models.BackgroundJob) error {
	if job == nil {
		return errors.New("scan deletion job is missing")
	}
	remaining, err := scanIDsFromPayload(job.Payload)
	if err != nil {
		return workerjobs.NewSafeError("scan deletion job could not be resumed", err)
	}
	total := job.ProgressTotal
	if total < len(remaining)+job.ProgressCurrent {
		total = len(remaining) + job.ProgressCurrent
	}
	if total == 0 {
		return nil
	}
	current := job.ProgressCurrent
	for len(remaining) > 0 {
		if err := ctx.Err(); err != nil {
			return err
		}
		batchSize := scanDeletionBatchSize
		if len(remaining) < batchSize {
			batchSize = len(remaining)
		}
		batch := append([]uuid.UUID(nil), remaining[:batchSize]...)
		batchStart := current + 1
		batchEnd := current + batchSize
		if batchEnd > total {
			batchEnd = total
		}
		phase := fmt.Sprintf("Deleting scans %d–%d of %d", batchStart, batchEnd, total)
		if err := workerjobs.UpdateProgress(ctx, db, job.ID, job.LeaseOwner, current, total, phase, nil); err != nil {
			return err
		}
		job.Phase = phase

		var scans []models.Scan
		if err := db.NewSelect().Model(&scans).Where("id IN (?)", bun.In(batch)).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return workerjobs.NewSafeError("failed to load a scan deletion batch", err)
		}
		if len(scans) > 0 {
			archiveSessions, err := loadArchiveUploadSessionsForScans(ctx, db, batch)
			if err != nil {
				return workerjobs.NewSafeError("failed to resolve uploaded archive cleanup", err)
			}
			batchCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
			err = db.RunInTx(batchCtx, nil, func(txCtx context.Context, tx bun.Tx) error {
				return deleteScanRecords(txCtx, tx, batch)
			})
			cancel()
			if err != nil {
				return workerjobs.NewSafeError(scanGroupDeletionErrorMessage(err), err)
			}
			if cleanupErr := cleanupArchiveUploadSessions(archiveSessions); cleanupErr != nil {
				log.WithError(cleanupErr).WithField("job_id", job.ID).Warn("scan deletion archive cleanup failed")
			}
			for index := range scans {
				if cleanupErr := cleanupQueuedUploadedArchiveScan(&scans[index]); cleanupErr != nil {
					log.WithError(cleanupErr).WithField("job_id", job.ID).Warn("scan deletion upload cleanup failed")
				}
			}
		}

		remaining = remaining[batchSize:]
		current += batchSize
		if current > total {
			current = total
		}
		job.Payload["scan_ids"] = scanIDStrings(remaining)
		phase = fmt.Sprintf("Deleted %d of %d scans", current, total)
		if err := workerjobs.UpdateProgress(ctx, db, job.ID, job.LeaseOwner, current, total, phase, job.Payload); err != nil {
			return err
		}
		job.ProgressCurrent = current
		job.ProgressTotal = total
		job.Phase = phase
	}

	go audit.Write(context.Background(), db, job.UserID.String(), "scan.group_delete",
		fmt.Sprintf("Deleted %d scans for %s", total, deletionAuditTarget(job)))
	return nil
}

func deletionAuditTarget(job *models.BackgroundJob) string {
	if job == nil {
		return "scan group"
	}
	if imageName, ok := job.Metadata["image_name"].(string); ok && strings.TrimSpace(imageName) != "" {
		if imageTag, ok := job.Metadata["image_tag"].(string); ok && strings.TrimSpace(imageTag) != "" {
			return imageName + ":" + imageTag
		}
		return imageName
	}
	return "scan group"
}

func scanIDsFromPayload(payload models.JSONObject) ([]uuid.UUID, error) {
	raw, ok := payload["scan_ids"]
	if !ok {
		return nil, errors.New("scan deletion payload has no scan IDs")
	}
	values, ok := raw.([]interface{})
	if !ok {
		if stringsList, stringOK := raw.([]string); stringOK {
			values = make([]interface{}, len(stringsList))
			for index := range stringsList {
				values[index] = stringsList[index]
			}
		} else {
			return nil, errors.New("scan deletion payload has invalid scan IDs")
		}
	}
	result := make([]uuid.UUID, 0, len(values))
	for _, value := range values {
		rawID, ok := value.(string)
		if !ok {
			return nil, errors.New("scan deletion payload has an invalid scan ID")
		}
		id, err := uuid.Parse(rawID)
		if err != nil {
			return nil, fmt.Errorf("invalid scan ID in deletion payload: %w", err)
		}
		result = append(result, id)
	}
	return result, nil
}

func scanGroupDeletionErrorMessage(err error) string {
	var networkError net.Error
	if strings.Contains(err.Error(), "lock vulnerability mutations before scan deletion") &&
		(errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &networkError) && networkError.Timeout())) {
		return "database timed out while preparing scan history deletion; please retry"
	}
	return "failed to delete scan group"
}
