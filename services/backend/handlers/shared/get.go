package shared

import (
	"net/http"
	"strings"

	"justscan-backend/functions/auth"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

// getScanByShareToken looks up a scan by share_token and enforces visibility access control.
// On success returns the scan; on error it writes the response and returns nil.
func getScanByShareToken(c *gin.Context, db *bun.DB) *models.Scan {
	token := c.Param("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing share token"})
		return nil
	}

	var scan models.Scan
	if err := db.NewSelect().Model(&scan).
		Where("share_token = ?", token).
		Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "shared scan not found"})
		return nil
	}

	// Enforce visibility: "authenticated" requires a valid JWT
	if scan.ShareVisibility != nil && *scan.ShareVisibility == "authenticated" {
		raw := c.GetHeader("Authorization")
		tokenString := strings.TrimPrefix(raw, "Bearer ")
		if tokenString == "" || auth.ValidateToken(tokenString) != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required to view this scan"})
			return nil
		}
	}

	return &scan
}

// GetSharedScan returns scan metadata for the given share token.
func GetSharedScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scan := getScanByShareToken(c, db)
		if scan == nil {
			return
		}
		var stepLogs []models.ScanStepLog
		db.NewSelect().
			Model(&stepLogs).
			Where("scan_id = ?", scan.ID).
			OrderExpr("position ASC").
			Scan(c.Request.Context()) //nolint:errcheck
		scan.StepLogs = stepLogs
		c.JSON(http.StatusOK, scan)
	}
}
