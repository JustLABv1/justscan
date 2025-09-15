package geraete

import (
	"net/http"

	"justwms/functions/csvreader"
	"justwms/pkg/models"

	_ "github.com/lib/pq"
	"github.com/uptrace/bun"

	"github.com/gin-gonic/gin"
)

func UploadGeraete(c *gin.Context, db *bun.DB) {
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
	geraete, err := csvreader.ReadGeraeteCSV(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// get geraete from db
	var dbGeraete []models.Geraete
	err = db.NewSelect().Model(&dbGeraete).Scan(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// diff geraete and dbGeraete
	var newGeraete []models.Geraete
	for _, k := range geraete {
		found := false
		for _, dbk := range dbGeraete {
			if k.Geraetenummer == dbk.Geraetenummer {
				found = true
				break
			}
		}
		if !found {
			newGeraete = append(newGeraete, k)
		}
	}

	if newGeraete == nil || len(newGeraete) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"result": "no new geraete",
		})
		return
	}

	if newGeraete == nil || len(newGeraete) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"result": "no new geraete",
		})
		return
	}

	_, err = db.NewInsert().Model(&newGeraete).Exec(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"result": "success",
	})
}
