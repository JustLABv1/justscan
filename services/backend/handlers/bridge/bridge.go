package bridge

import (
	"net/http"
	"time"

	"justwms-backend/functions/auth"
	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type BridgeRegistration struct {
	BridgeID      string    `json:"bridge_id" binding:"required"`
	BridgeName    string    `json:"bridge_name" binding:"required"`
	Version       string    `json:"version"`
	UploadURL     string    `json:"upload_url" binding:"required"`
	HealthURL     string    `json:"health_url" binding:"required"`
	MaxFileSize   int64     `json:"max_file_size"`
	LastHeartbeat time.Time `json:"last_heartbeat"`
}

func RegisterBridge(context *gin.Context, db *bun.DB) {
	var registration BridgeRegistration
	if err := context.ShouldBindJSON(&registration); err != nil {
		httperror.StatusBadRequest(context, "Error parsing bridge registration data", err)
		return
	}

	bridgeID, _, err := auth.GetBridgeDataFromToken(context.GetHeader("Authorization"))
	if err != nil {
		httperror.Unauthorized(context, "Error receiving bridgeID from token", err)
		return
	}

	// check if token bridgeID matches registration.BridgeID
	if bridgeID != registration.BridgeID {
		httperror.Unauthorized(context, "Bridge ID in token does not match registration data", nil)
		return
	}

	// check if bridge already exists in DB, if not create it
	var bridge models.CSVBridge
	err = db.NewSelect().
		Model(&bridge).
		Where("bridge_id = ?", registration.BridgeID).
		Scan(context)
	if err != nil {
		// create new bridge
		bridge = models.CSVBridge{
			ID:            uuid.New(),
			BridgeID:      registration.BridgeID,
			BridgeName:    registration.BridgeName,
			Version:       registration.Version,
			UploadURL:     registration.UploadURL,
			HealthURL:     registration.HealthURL,
			MaxFileSize:   registration.MaxFileSize,
			LastHeartbeat: registration.LastHeartbeat,
			CreatedAt:     time.Now(),
			UpdatedAt:     time.Now(),
		}
		_, err = db.NewInsert().
			Model(&bridge).
			Exec(context)
		if err != nil {
			httperror.InternalServerError(context, "Error creating new bridge", err)
			return
		}
	} else {
		// update existing bridge
		bridge.BridgeName = registration.BridgeName
		bridge.Version = registration.Version
		bridge.UploadURL = registration.UploadURL
		bridge.HealthURL = registration.HealthURL
		bridge.MaxFileSize = registration.MaxFileSize
		bridge.LastHeartbeat = registration.LastHeartbeat
		bridge.UpdatedAt = time.Now()

		_, err = db.NewUpdate().
			Model(&bridge).
			Where("bridge_id = ?", registration.BridgeID).
			Exec(context)
		if err != nil {
			httperror.InternalServerError(context, "Error updating bridge", err)
			return
		}
	}

	context.JSON(http.StatusOK, gin.H{
		"status":      "success",
		"message":     "Bridge registered successfully",
		"bridge_id":   bridge.BridgeID,
		"bridge_name": bridge.BridgeName,
	})
}
