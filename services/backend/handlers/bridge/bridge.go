package bridge

import (
	"net/http"
	"strings"
	"time"

	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

type BridgeRegistration struct {
	ServiceID     string    `json:"service_id" binding:"required"`
	ServiceName   string    `json:"service_name" binding:"required"`
	Version       string    `json:"version"`
	UploadURL     string    `json:"upload_url" binding:"required"`
	HealthURL     string    `json:"health_url" binding:"required"`
	APIKey        string    `json:"api_key" binding:"required"`
	MaxFileSize   int64     `json:"max_file_size"`
	LastHeartbeat time.Time `json:"last_heartbeat"`
}

// RegisterBridge handles bridge service registration
func RegisterBridge(context *gin.Context, db *bun.DB) {
	var registration BridgeRegistration
	if err := context.ShouldBindJSON(&registration); err != nil {
		httperror.StatusBadRequest(context, "Error parsing bridge registration data", err)
		return
	}

	log.Infof("Received bridge registration request for service_id: %s, service_name: %s",
		registration.ServiceID, registration.ServiceName)

	// Update last heartbeat if not set
	if registration.LastHeartbeat.IsZero() {
		registration.LastHeartbeat = time.Now()
	}

	// Check if bridge already exists
	var existingBridge models.CSVBridge
	err := db.NewSelect().
		Model(&existingBridge).
		Where("service_id = ?", registration.ServiceID).
		Scan(context)

	// Handle the case where bridge exists
	if err == nil {
		// Bridge exists, update it
		log.Infof("Bridge with service_id %s already exists, updating registration", registration.ServiceID)

		_, err = db.NewUpdate().
			Model((*models.CSVBridge)(nil)).
			Set("service_name = ?, version = ?, upload_url = ?, health_url = ?, api_key = ?, max_file_size = ?, is_active = ?, last_heartbeat = ?, updated_at = ?",
				registration.ServiceName, registration.Version, registration.UploadURL,
				registration.HealthURL, registration.APIKey, registration.MaxFileSize,
				true, registration.LastHeartbeat, time.Now()).
			Where("service_id = ?", registration.ServiceID).
			Exec(context)

		if err != nil {
			httperror.InternalServerError(context, "Error updating bridge registration", err)
			return
		}

		log.Infof("Updated bridge registration for service: %s", registration.ServiceID)

		// Return the existing bridge ID
		context.JSON(http.StatusOK, gin.H{
			"status":     "success",
			"message":    "Bridge registration updated successfully",
			"bridge_id":  existingBridge.ID,
			"service_id": existingBridge.ServiceID,
		})
		return
	}

	// Check if error is something other than "no rows found"
	if err.Error() != "sql: no rows in result set" {
		httperror.InternalServerError(context, "Error checking existing bridge", err)
		return
	}

	// Bridge doesn't exist, create new one
	log.Infof("Creating new bridge registration for service: %s", registration.ServiceID)

	bridge := models.CSVBridge{
		ServiceID:     registration.ServiceID,
		ServiceName:   registration.ServiceName,
		Version:       registration.Version,
		UploadURL:     registration.UploadURL,
		HealthURL:     registration.HealthURL,
		APIKey:        registration.APIKey,
		MaxFileSize:   registration.MaxFileSize,
		IsActive:      true,
		LastHeartbeat: registration.LastHeartbeat,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	_, err = db.NewInsert().
		Model(&bridge).
		Exec(context)

	if err != nil {
		// Handle potential race condition where another process created the bridge
		errorStr := err.Error()
		if errorStr == `ERROR: duplicate key value violates unique constraint "csv_bridges_service_id_key" (SQLSTATE=23505)` ||
			errorStr == `ERROR: duplicate key value violates unique constraint "csv_bridges_pkey" (SQLSTATE=23505)` ||
			strings.Contains(errorStr, "duplicate key value violates unique constraint") ||
			strings.Contains(errorStr, "SQLSTATE=23505") {
			log.Warnf("Bridge with service_id %s was created by another process, attempting update", registration.ServiceID)

			_, err = db.NewUpdate().
				Model((*models.CSVBridge)(nil)).
				Set("service_name = ?, version = ?, upload_url = ?, health_url = ?, api_key = ?, max_file_size = ?, is_active = ?, last_heartbeat = ?, updated_at = ?",
					registration.ServiceName, registration.Version, registration.UploadURL,
					registration.HealthURL, registration.APIKey, registration.MaxFileSize,
					true, registration.LastHeartbeat, time.Now()).
				Where("service_id = ?", registration.ServiceID).
				Exec(context)

			if err != nil {
				httperror.InternalServerError(context, "Error updating bridge registration after duplicate key error", err)
				return
			}

			// Get the bridge ID for response
			var updatedBridge models.CSVBridge
			err = db.NewSelect().
				Model(&updatedBridge).
				Where("service_id = ?", registration.ServiceID).
				Scan(context)

			if err != nil {
				httperror.InternalServerError(context, "Error retrieving updated bridge", err)
				return
			}

			context.JSON(http.StatusOK, gin.H{
				"status":     "success",
				"message":    "Bridge registration updated successfully (race condition handled)",
				"bridge_id":  updatedBridge.ID,
				"service_id": updatedBridge.ServiceID,
			})
			return
		}

		httperror.InternalServerError(context, "Error creating bridge registration", err)
		return
	}

	log.Infof("Created new bridge registration for service: %s", registration.ServiceID)

	context.JSON(http.StatusOK, gin.H{
		"status":     "success",
		"message":    "Bridge registered successfully",
		"bridge_id":  bridge.ID,
		"service_id": bridge.ServiceID,
	})
}

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
