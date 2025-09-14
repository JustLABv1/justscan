package kostenstellen

import (
	"net/http"

	"justwms/functions/csvreader"

	_ "github.com/lib/pq"
	"github.com/uptrace/bun"

	"github.com/gin-gonic/gin"
)

func CheckUploadedKostenstellen(c *gin.Context, db *bun.DB) {
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
	kostenstellen, err := csvreader.ReadKostenstellenCSV(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"result":        "success",
		"kostenstellen": kostenstellen,
		"count":         len(kostenstellen),
	})
}
