package bridge

import (
	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

// ListBridges returns all registered bridge services
func ListBridges(context *gin.Context, db *bun.DB) {
	var bridges []models.CSVBridge

	err := db.NewSelect().
		Model(&bridges).
		Where("is_active = ?", true).
		Order("created_at DESC").
		Scan(context)

	if err != nil {
		httperror.InternalServerError(context, "Error retrieving bridge services", err)
		return
	}

	// Check which bridges are healthy (heartbeat within last 10 minutes)
	healthyThreshold := time.Now().Add(-10 * time.Minute)
	for i := range bridges {
		bridges[i].IsHealthy = bridges[i].LastHeartbeat.After(healthyThreshold)
	}

	context.JSON(http.StatusOK, gin.H{
		"result":  "success",
		"bridges": bridges,
		"count":   len(bridges),
	})
}
