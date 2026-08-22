package scans

import (
	"errors"
	"net/http"
	"strings"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func UpdateScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}

		var body struct {
			ImageLocation *string `json:"image_location"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}

		scan, _, _, ok := LoadAuthorizedScanForWrite(c, db, scanID)
		if !ok {
			return
		}
		if err := validateImageLocationUpdate(scan, body.ImageLocation); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if scan.ScanSource != models.ScanSourceUploadedArchive && *body.ImageLocation != scan.ImageLocation {
			if _, err := db.NewUpdate().
				Model((*models.Scan)(nil)).
				Set("image_location = ?", *body.ImageLocation).
				Where("id = ?", scanID).
				Exec(c.Request.Context()); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update scan"})
				return
			}
		}

		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// validateImageLocationUpdate keeps local archive paths under the control of
// the scan creation flow. The PATCH endpoint historically let a scan owner
// replace one with an arbitrary absolute or traversal path, which the worker
// later opened. Registry image_location values are display metadata used by
// reports, so they retain their existing editing behavior.
func validateImageLocationUpdate(scan *models.Scan, requested *string) error {
	if scan == nil {
		return errors.New("scan not found")
	}
	if requested == nil {
		return errors.New("image_location is required")
	}
	if scan.ScanSource != models.ScanSourceRegistry && *requested != scan.ImageLocation {
		return errors.New("image_location is immutable")
	}
	if strings.IndexByte(*requested, 0) >= 0 {
		return errors.New("image_location contains an invalid character")
	}
	if len(*requested) > 4096 {
		return errors.New("image_location is too long")
	}
	if scan.ScanSource == models.ScanSourceUploadedArchive && !isControlledUploadedArchivePath(scan.ImageLocation) {
		return errors.New("uploaded archive path is invalid")
	}
	return nil
}
