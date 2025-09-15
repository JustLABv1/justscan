package artikel

import (
	"net/http"

	"justwms/functions/csvreader"
	"justwms/pkg/models"

	_ "github.com/lib/pq"
	"github.com/uptrace/bun"

	"github.com/gin-gonic/gin"
)

func CheckUploadedArtikel(c *gin.Context, db *bun.DB) {
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

	// get artikel from db
	var dbArtikel []models.Artikel
	err = db.NewSelect().Model(&dbArtikel).Scan(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// diff artikel and dbArtikel
	var newArtikel []models.Artikel
	for _, k := range artikel {
		found := false
		for _, dbk := range dbArtikel {
			if k.Artikelnummer == dbk.Artikelnummer {
				found = true
				break
			}
		}
		if !found {
			newArtikel = append(newArtikel, k)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"result":    "success",
		"artikel":   artikel,
		"count":     len(artikel),
		"db":        dbArtikel,
		"db_count":  len(dbArtikel),
		"new":       newArtikel,
		"new_count": len(newArtikel),
	})
}
