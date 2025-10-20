package bridge

import (
	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

// GetActiveBridges returns only active and healthy bridge services
func GetActiveBridges(context *gin.Context, db *bun.DB) {
	var bridges []models.CSVBridge

	// Only get bridges that have sent a heartbeat in the last 5 minutes
	healthyThreshold := time.Now().Add(-5 * time.Minute)

	err := db.NewSelect().
		Model(&bridges).
		Where("is_active = ? AND last_heartbeat > ?", true, healthyThreshold).
		Order("last_heartbeat DESC").
		Scan(context)

	if err != nil {
		httperror.InternalServerError(context, "Error retrieving active bridge services", err)
		return
	}

	// Mark all as healthy since they passed the threshold check
	for i := range bridges {
		bridges[i].IsHealthy = true
	}

	context.JSON(http.StatusOK, gin.H{
		"result":  "success",
		"bridges": bridges,
		"count":   len(bridges),
	})
}
