package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"csv-bridge/config"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
)

type UploadResponse struct {
	Status    string    `json:"status"`
	Message   string    `json:"message"`
	Filename  string    `json:"filename"`
	FileID    string    `json:"file_id"`
	Size      int64     `json:"size"`
	Timestamp time.Time `json:"timestamp"`
}

type ErrorResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
	Error   string `json:"error,omitempty"`
}

// UploadCSV handles CSV file uploads from the VPS application
func UploadCSV(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Validate API key
		apiKey := c.GetHeader("X-API-Key")
		if apiKey == "" {
			apiKey = c.Query("api_key")
		}
		if apiKey != cfg.Security.APIKey {
			c.JSON(http.StatusUnauthorized, ErrorResponse{
				Status:  "error",
				Message: "Invalid or missing API key",
			})
			return
		}

		// Parse the multipart form
		err := c.Request.ParseMultipartForm(cfg.Server.MaxFileSize)
		if err != nil {
			log.Errorf("Failed to parse multipart form: %v", err)
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Status:  "error",
				Message: "Failed to parse form data",
				Error:   err.Error(),
			})
			return
		}

		// Get the file from the form
		file, header, err := c.Request.FormFile("file")
		if err != nil {
			log.Errorf("Failed to get file from form: %v", err)
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Status:  "error",
				Message: "No file found in request",
				Error:   err.Error(),
			})
			return
		}
		defer file.Close()

		// Validate file size
		if header.Size > cfg.Server.MaxFileSize {
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Status:  "error",
				Message: fmt.Sprintf("File size exceeds maximum allowed size of %d bytes", cfg.Server.MaxFileSize),
			})
			return
		}

		// Generate unique filename
		fileID := uuid.New().String()
		originalExt := filepath.Ext(header.Filename)
		filename := fmt.Sprintf("%s_%s%s", fileID[:8], time.Now().Format("20060102_150405"), originalExt)

		// Ensure upload directory exists
		if err := os.MkdirAll(cfg.Server.UploadDir, 0755); err != nil {
			log.Errorf("Failed to create upload directory: %v", err)
			c.JSON(http.StatusInternalServerError, ErrorResponse{
				Status:  "error",
				Message: "Failed to create upload directory",
				Error:   err.Error(),
			})
			return
		}

		// Create destination file
		filePath := filepath.Join(cfg.Server.UploadDir, filename)
		destFile, err := os.Create(filePath)
		if err != nil {
			log.Errorf("Failed to create destination file: %v", err)
			c.JSON(http.StatusInternalServerError, ErrorResponse{
				Status:  "error",
				Message: "Failed to create destination file",
				Error:   err.Error(),
			})
			return
		}
		defer destFile.Close()

		// Copy file content
		size, err := io.Copy(destFile, file)
		if err != nil {
			log.Errorf("Failed to save file: %v", err)
			// Clean up failed file
			os.Remove(filePath)
			c.JSON(http.StatusInternalServerError, ErrorResponse{
				Status:  "error",
				Message: "Failed to save file",
				Error:   err.Error(),
			})
			return
		}

		log.Infof("Successfully uploaded file: %s (size: %d bytes) to %s", header.Filename, size, filePath)

		// Return success response
		c.JSON(http.StatusOK, UploadResponse{
			Status:    "success",
			Message:   "File uploaded successfully",
			Filename:  filename,
			FileID:    fileID,
			Size:      size,
			Timestamp: time.Now(),
		})
	}
}

// HealthCheck provides a simple health check endpoint
func HealthCheck(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Check if upload directory is accessible
		_, err := os.Stat(cfg.Server.UploadDir)
		uploadDirOK := err == nil

		status := "healthy"
		if !uploadDirOK {
			status = "degraded"
		}

		c.JSON(http.StatusOK, gin.H{
			"status":        status,
			"service":       cfg.Bridge.ServiceName,
			"version":       cfg.Bridge.Version,
			"service_id":    cfg.Bridge.ServiceID,
			"timestamp":     time.Now(),
			"upload_dir":    cfg.Server.UploadDir,
			"upload_dir_ok": uploadDirOK,
		})
	}
}

// GetServiceInfo returns information about this bridge service
func GetServiceInfo(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"service_id":         cfg.Bridge.ServiceID,
			"service_name":       cfg.Bridge.ServiceName,
			"version":            cfg.Bridge.Version,
			"upload_url":         fmt.Sprintf("http://%s:%d/upload", cfg.Server.Host, cfg.Server.Port),
			"health_url":         fmt.Sprintf("http://%s:%d/health", cfg.Server.Host, cfg.Server.Port),
			"max_file_size":      cfg.Server.MaxFileSize,
			"vps_url":            cfg.VPS.BaseURL,
			"heartbeat_interval": cfg.VPS.RegisterInterval,
			"timestamp":          time.Now(),
		})
	}
}

// GetHeartbeatStatus returns current heartbeat configuration and test result
func GetHeartbeatStatus(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		status := gin.H{
			"vps_url":            cfg.VPS.BaseURL,
			"heartbeat_interval": cfg.VPS.RegisterInterval,
			"service_id":         cfg.Bridge.ServiceID,
			"timestamp":          time.Now(),
		}

		// Test VPS connectivity
		if cfg.VPS.BaseURL != "" && cfg.VPS.APIToken != "" {
			// Try to ping the VPS registration endpoint
			registrationURL := fmt.Sprintf("%s/api/v1/bridge/register", cfg.VPS.BaseURL)
			client := &http.Client{Timeout: 10 * time.Second}

			// Create a simple HEAD request to test connectivity
			req, err := http.NewRequest("HEAD", registrationURL, nil)
			if err == nil {
				req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", cfg.VPS.APIToken))
				resp, err := client.Do(req)
				if err != nil {
					status["vps_connectivity"] = "error"
					status["vps_error"] = err.Error()
				} else {
					resp.Body.Close()
					status["vps_connectivity"] = "ok"
					status["vps_status_code"] = resp.StatusCode
				}
			} else {
				status["vps_connectivity"] = "error"
				status["vps_error"] = err.Error()
			}
		} else {
			status["vps_connectivity"] = "not_configured"
		}

		c.JSON(http.StatusOK, status)
	}
}
