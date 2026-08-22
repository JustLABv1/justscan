package scans

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"justscan-backend/functions/audit"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

const scanGroupDeletionTimeout = 30 * time.Minute

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
		if err := query.Scan(c.Request.Context()); err != nil {
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
		archiveSessions, err := loadArchiveUploadSessionsForScans(c.Request.Context(), db, scanIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve uploaded archive cleanup"})
			return
		}

		deleteCtx, cancelDelete := context.WithTimeout(c.Request.Context(), scanGroupDeletionTimeout)
		deletionStartedAt := time.Now()
		err = db.RunInTx(deleteCtx, nil, func(ctx context.Context, tx bun.Tx) error {
			return deleteScanRecords(ctx, tx, scanIDs)
		})
		cancelDelete()
		if err != nil {
			log.WithError(err).Errorf("delete scan group failed for %s", imageName)
			c.JSON(http.StatusInternalServerError, gin.H{"error": scanGroupDeletionErrorMessage(err)})
			return
		}
		log.WithField("duration", time.Since(deletionStartedAt)).Infof("deleted scan group for %s", imageName)
		_ = cleanupArchiveUploadSessions(archiveSessions)
		for index := range scans {
			_ = cleanupQueuedUploadedArchiveScan(&scans[index])
		}

		auditTarget := imageName
		if requireTag {
			auditTarget += ":" + imageTag
		}
		go audit.Write(context.Background(), db, userID.String(), "scan.group_delete",
			fmt.Sprintf("Deleted %d scans for %s", len(scanIDs), auditTarget))

		c.JSON(http.StatusOK, gin.H{"deleted": len(scanIDs)})
	}
}

func scanGroupDeletionErrorMessage(err error) string {
	var networkError net.Error
	if strings.Contains(err.Error(), "lock vulnerability mutations before scan deletion") &&
		(errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &networkError) && networkError.Timeout())) {
		return "database timed out while preparing scan history deletion; please retry"
	}
	return "failed to delete scan group"
}
