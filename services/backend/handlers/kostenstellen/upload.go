package kostenstellen

import (
	"net/http"

	"justwms-backend/pkg/csvreader"
	"justwms-backend/pkg/models"

	_ "github.com/lib/pq"
	"github.com/uptrace/bun"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

func UploadKostenstellen(c *gin.Context, db *bun.DB) {
	// Get the uploaded file
	file, _, err := c.Request.FormFile("csv")
	if err != nil {
		log.Errorf("Failed to get file from request: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to get file"})
		return
	}
	defer file.Close()

	// Get the upload type
	uploadType := c.PostForm("type")
	if uploadType == "" {
		log.Error("Upload type is required")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Upload type is required"})
		return
	}

	// Read the CSV file
	kostenstellen, err := csvreader.ReadKostenstellenCSV(file)
	if err != nil {
		log.Errorf("Failed to read kostenstellen CSV: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// delete existing kostenstellen
	_, err = db.NewDelete().Model((*models.Kostenstellen)(nil)).Where("1=1").Exec(c)
	if err != nil {
		log.Errorf("Failed to delete existing kostenstellen: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	_, err = db.NewInsert().Model(&kostenstellen).Exec(c)
	if err != nil {
		log.Errorf("Failed to insert kostenstellen: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"result": "success",
	})
}
