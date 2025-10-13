package lieferschein

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"justwms-backend/config"
	"justwms-backend/functions/httperror"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// DownloadLieferscheinCSV allows downloading the generated CSV file
func DownloadLieferscheinCSV(context *gin.Context, db *bun.DB) {
	lieferscheinID := context.Param("id")
	if lieferscheinID == "" {
		httperror.StatusBadRequest(context, "Lieferschein ID is required", nil)
		return
	}

	// Construct the CSV filename based on the lieferschein ID
	filename := fmt.Sprintf("lieferschein_%s.csv", lieferscheinID)
	filePath := filepath.Join(config.Config.Lieferschein.ExportPath, filename)

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		httperror.StatusNotFound(context, "CSV file not found", err)
		return
	}

	// Open and serve the file
	file, err := os.Open(filePath)
	if err != nil {
		httperror.InternalServerError(context, "Error opening CSV file", err)
		return
	}
	defer file.Close()

	// Get file info for content length
	fileInfo, err := file.Stat()
	if err != nil {
		httperror.InternalServerError(context, "Error getting file info", err)
		return
	}

	// Set headers for download
	context.Header("Content-Type", "text/csv")
	context.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	context.Header("Content-Length", fmt.Sprintf("%d", fileInfo.Size()))

	// Serve the file
	http.ServeContent(context.Writer, context.Request, filename, fileInfo.ModTime(), file)

	log.Infof("CSV file %s downloaded", filename)
}
