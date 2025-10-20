package lieferschein

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"time"

	"justwms-backend/config"
	"justwms-backend/functions/functions_lieferschein"
	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// transferCSVToBridge transfers the CSV file to the first available active bridge
func transferCSVToBridge(csvFilePath string, lieferscheinID string, db *bun.DB, context *gin.Context) (bool, string) {
	// Get the first active bridge
	var bridge models.CSVBridge
	healthyThreshold := time.Now().Add(-5 * time.Minute)

	err := db.NewSelect().
		Model(&bridge).
		Where("is_active = ? AND last_heartbeat > ?", true, healthyThreshold).
		Order("last_heartbeat DESC").
		Limit(1).
		Scan(context)

	if err != nil {
		log.Warnf("No active bridge services found: %v", err)
		return false, "No active bridge services available"
	}

	log.Infof("Found active bridge: %s (%s)", bridge.BridgeName, bridge.UploadURL)

	// Read the CSV file
	fileContent, err := os.ReadFile(csvFilePath)
	if err != nil {
		log.Errorf("Failed to read CSV file: %v", err)
		return false, fmt.Sprintf("Failed to read CSV file: %v", err)
	}

	// Create multipart form for file upload
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	// Create form file field
	fileWriter, err := writer.CreateFormFile("file", fmt.Sprintf("lieferschein_%s.csv", lieferscheinID))
	if err != nil {
		log.Errorf("Failed to create form file: %v", err)
		return false, fmt.Sprintf("Failed to create form file: %v", err)
	}

	// Write file content to form
	_, err = fileWriter.Write(fileContent)
	if err != nil {
		log.Errorf("Failed to write file to form: %v", err)
		return false, fmt.Sprintf("Failed to write file to form: %v", err)
	}

	// Close the writer to finalize the form
	writer.Close()

	// Create HTTP request to bridge service
	req, err := http.NewRequest("POST", bridge.UploadURL, &body)
	if err != nil {
		log.Errorf("Failed to create request: %v", err)
		return false, fmt.Sprintf("Failed to create request: %v", err)
	}

	// Set headers
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-API-Key", bridge.APIKey)

	// Send the request
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Errorf("Failed to upload file to bridge: %v", err)
		return false, fmt.Sprintf("Failed to upload file to bridge: %v", err)
	}
	defer resp.Body.Close()

	// Read response
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Errorf("Failed to read upload response: %v", err)
	}

	// Check if upload was successful
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		log.Infof("Successfully uploaded CSV to bridge %s (status: %d)", bridge.BridgeName, resp.StatusCode)
		return true, string(responseBody)
	} else {
		log.Errorf("Bridge upload failed with status %d: %s", resp.StatusCode, string(responseBody))
		return false, fmt.Sprintf("Bridge upload failed (status %d): %s", resp.StatusCode, string(responseBody))
	}
}

func CreateLieferschein(context *gin.Context, db *bun.DB) {
	var lieferschein models.Lieferschein
	if err := context.ShouldBindJSON(&lieferschein); err != nil {
		httperror.StatusBadRequest(context, "Error parsing incoming data", err)
		return
	}

	_, err := db.NewInsert().Model(&lieferschein).Exec(context)
	if err != nil {
		httperror.InternalServerError(context, "Error creating lieferschein on db", err)
		return
	}

	// Generate the CSV file
	csvFilePath, err := functions_lieferschein.GenerateLieferscheinCSV(lieferschein, config.Config)
	if err != nil {
		httperror.InternalServerError(context, "Error generating CSV file", err)
		log.Error("Error generating CSV file:", err)
		return
	}

	log.Infof("Lieferschein CSV generated at: %s", csvFilePath)

	// Attempt to transfer CSV to bridge service
	transferred, transferResult := transferCSVToBridge(csvFilePath, lieferschein.ID.String(), db, context)

	response := gin.H{
		"result":          "success",
		"lieferschein_id": lieferschein.ID.String(),
		"csv_file_path":   csvFilePath,
	}

	if transferred {
		log.Infof("CSV file successfully transferred to bridge service")
		response["bridge_transfer"] = "success"
		response["bridge_response"] = transferResult
	} else {
		log.Warnf("CSV file could not be transferred to bridge: %s", transferResult)
		response["bridge_transfer"] = "failed"
		response["bridge_error"] = transferResult
		response["note"] = "CSV file generated locally but bridge transfer failed. File can be downloaded manually."
	}

	context.JSON(http.StatusCreated, response)
}
