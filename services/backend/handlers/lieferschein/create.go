package lieferschein

import (
	"net/http"

	"justwms-backend/config"
	"justwms-backend/functions/functions_lieferschein"
	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

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

	log.Info("Lieferschein CSV generated at:", csvFilePath)

	context.JSON(http.StatusCreated, gin.H{"result": "success"})
}
