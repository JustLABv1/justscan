package artikel

import (
	"net/http"

	"justwms/functions/csvreader"
	"justwms/pkg/models"

	_ "github.com/lib/pq"
	"github.com/uptrace/bun"

	"github.com/gin-gonic/gin"
)

func UploadArtikel(c *gin.Context, db *bun.DB) {
	// Get the uploaded file
	file, _, err := c.Request.FormFile("csv")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to get file"})
		return
	}
	defer file.Close()

	// Get the upload type
	uploadType := c.PostForm("type")
	if uploadType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Upload type is required"})
		return
	}

	// Read the CSV file
	artikel, err := csvreader.ReadArtikelCSV(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Delete all existing records
	_, err = db.NewTruncateTable().Model((*models.Artikel)(nil)).Exec(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to truncate table"})
		return
	}

	// Insert the new records
	_, err = db.NewInsert().Model(&artikel).Exec(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to insert records", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"result": "success",
	})
}
