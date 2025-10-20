package lieferschein

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"justwms-backend/config"
	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// TransferRequest represents the request body for file transfer
type TransferRequest struct {
	LieferscheinID  string            `json:"lieferschein_id" binding:"required"`
	BridgeServiceID string            `json:"bridge_service_id,omitempty"` // Use registered bridge service
	TargetURL       string            `json:"target_url,omitempty"`        // Manual target URL (fallback)
	AuthToken       string            `json:"auth_token,omitempty"`        // Optional authentication token
	CustomHeaders   map[string]string `json:"custom_headers,omitempty"`    // Optional custom headers
	FieldName       string            `json:"field_name,omitempty"`        // Form field name for file upload, defaults to "file"
}

// TransferLieferscheinCSV transfers the CSV file directly to customer's server
func TransferLieferscheinCSV(context *gin.Context, db *bun.DB) {
	var request TransferRequest
	if err := context.ShouldBindJSON(&request); err != nil {
		httperror.StatusBadRequest(context, "Error parsing transfer request", err)
		return
	}

	// Set default field name if not provided
	if request.FieldName == "" {
		request.FieldName = "file"
	}

	var targetURL string
	var apiKey string

	// If bridge service ID is provided, use registered bridge
	if request.BridgeServiceID != "" {
		var bridge models.CSVBridge
		err := db.NewSelect().
			Model(&bridge).
			Where("service_id = ? AND is_active = true", request.BridgeServiceID).
			Scan(context)

		if err != nil {
			httperror.StatusNotFound(context, "Bridge service not found or inactive", err)
			return
		}

		// Check if bridge is healthy (heartbeat within last 5 minutes)
		if time.Since(bridge.LastHeartbeat) > 5*time.Minute {
			context.JSON(http.StatusServiceUnavailable, gin.H{
				"result":  "error",
				"message": "Bridge service is not responding",
			})
			return
		}

		targetURL = bridge.UploadURL
		apiKey = bridge.APIKey
		log.Infof("Using registered bridge service: %s (%s)", bridge.BridgeName, bridge.BridgeID)
	} else if request.TargetURL != "" {
		// Fallback to manual URL
		targetURL = request.TargetURL
		log.Infof("Using manual target URL: %s", targetURL)
	} else {
		httperror.StatusBadRequest(context, "Either bridge_service_id or target_url must be provided", nil)
		return
	}

	// Construct the CSV filename based on the lieferschein ID
	filename := fmt.Sprintf("lieferschein_%s.csv", request.LieferscheinID)
	filePath := filepath.Join(config.Config.Lieferschein.ExportPath, filename)

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		httperror.StatusNotFound(context, "CSV file not found", err)
		return
	}

	// Read the CSV file
	fileContent, err := os.ReadFile(filePath)
	if err != nil {
		httperror.InternalServerError(context, "Error reading CSV file", err)
		return
	}

	// Create a multipart form for file upload
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	// Create form file field
	fileWriter, err := writer.CreateFormFile(request.FieldName, filename)
	if err != nil {
		httperror.InternalServerError(context, "Error creating form file", err)
		return
	}

	// Write file content to form
	_, err = fileWriter.Write(fileContent)
	if err != nil {
		httperror.InternalServerError(context, "Error writing file to form", err)
		return
	}

	// Close the writer to finalize the form
	writer.Close()

	// Create HTTP request to target server
	req, err := http.NewRequest("POST", targetURL, &body)
	if err != nil {
		httperror.InternalServerError(context, "Error creating request", err)
		return
	}

	// Set content type
	req.Header.Set("Content-Type", writer.FormDataContentType())

	// Add authentication headers
	if apiKey != "" {
		req.Header.Set("X-API-Key", apiKey)
	}
	if request.AuthToken != "" {
		req.Header.Set("Authorization", "Bearer "+request.AuthToken)
	}

	// Add custom headers if provided
	for key, value := range request.CustomHeaders {
		req.Header.Set(key, value)
	}

	// Send the request
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		httperror.InternalServerError(context, "Error uploading file to customer server", err)
		log.Errorf("Upload error: %v", err)
		return
	}
	defer resp.Body.Close()

	// Read response body
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Errorf("Error reading upload response: %v", err)
	}

	// Check if upload was successful
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		log.Infof("Successfully uploaded CSV file %s to %s", filename, request.TargetURL)
		context.JSON(http.StatusOK, gin.H{
			"result":          "success",
			"message":         "File transferred successfully",
			"filename":        filename,
			"target_url":      targetURL,
			"upload_status":   resp.StatusCode,
			"upload_response": string(responseBody),
		})
	} else {
		log.Errorf("Upload failed with status %d: %s", resp.StatusCode, string(responseBody))
		context.JSON(http.StatusBadGateway, gin.H{
			"result":          "error",
			"message":         "File transfer failed",
			"filename":        filename,
			"target_url":      targetURL,
			"upload_status":   resp.StatusCode,
			"upload_response": string(responseBody),
		})
	}
}
