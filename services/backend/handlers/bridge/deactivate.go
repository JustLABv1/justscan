package bridge

import (
	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"

	log "github.com/sirupsen/logrus"
)

// DeactivateBridge deactivates a bridge service
func DeactivateBridge(context *gin.Context, db *bun.DB) {
	bridgeID := context.Param("id")
	if bridgeID == "" {
		httperror.StatusBadRequest(context, "Bridge ID is required", nil)
		return
	}

	_, err := db.NewUpdate().
		Model((*models.CSVBridge)(nil)).
		Set("is_active = ?, updated_at = ?", false, time.Now()).
		Where("id = ?", bridgeID).
		Exec(context)

	if err != nil {
		httperror.InternalServerError(context, "Error deactivating bridge", err)
		return
	}

	log.Infof("Deactivated bridge: %s", bridgeID)

	context.JSON(http.StatusOK, gin.H{
		"result":  "success",
		"message": "Bridge deactivated successfully",
	})
}
