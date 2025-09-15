package kostenstellen

import (
	"net/http"

	"justwms/functions/csvreader"
	"justwms/pkg/models"

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

	// get kostenstellen from db
	var dbKostenstellen []models.Kostenstellen
	err = db.NewSelect().Model(&dbKostenstellen).Scan(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// diff kostenstellen and dbKostenstellen
	// find kostenstellen that are in kostenstellen but not in dbKostenstellen
	var newKostenstellen []models.Kostenstellen
	for _, k := range kostenstellen {
		found := false
		for _, dbk := range dbKostenstellen {
			if k.Kostenstellenummer == dbk.Kostenstellenummer {
				found = true
				break
			}
		}
		if !found {
			newKostenstellen = append(newKostenstellen, k)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"result":        "success",
		"kostenstellen": kostenstellen,
		"count":         len(kostenstellen),
		"db":            dbKostenstellen,
		"db_count":      len(dbKostenstellen),
		"new":           newKostenstellen,
		"new_count":     len(newKostenstellen),
	})
}
