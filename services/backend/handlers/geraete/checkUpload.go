package geraete

import (
	"net/http"

	"justwms-backend/pkg/csvreader"
	"justwms-backend/pkg/models"

	_ "github.com/lib/pq"
	"github.com/uptrace/bun"

	"github.com/gin-gonic/gin"
)

func CheckUploadedGeraete(c *gin.Context, db *bun.DB) {
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
	// find geraete that are in geraete but not in dbGeraete
	var newGeraete []models.Geraete
	for _, k := range geraete {
		found := false
		for _, dbk := range dbGeraete {
			if k.Betriebsnummer == dbk.Betriebsnummer {
				found = true
				break
			}
		}
		if !found {
			newGeraete = append(newGeraete, k)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"result":    "success",
		"geraete":   geraete,
		"count":     len(geraete),
		"db":        dbGeraete,
		"db_count":  len(dbGeraete),
		"new":       newGeraete,
		"new_count": len(newGeraete),
	})
}
