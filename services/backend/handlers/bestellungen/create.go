package bestellungen

import (
	"net/http"

	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
	"github.com/uptrace/bun"
)

func CreateBestellung(context *gin.Context, db *bun.DB) {
	var bestellung models.Bestellungen
	if err := context.ShouldBindJSON(&bestellung); err != nil {
		httperror.StatusBadRequest(context, "Error parsing incoming data", err)
		return
	}

	_, err := db.NewInsert().Model(&bestellung).Exec(context)
	if err != nil {
		httperror.InternalServerError(context, "Error creating bestellung on db", err)
		return
	}

	context.JSON(http.StatusCreated, gin.H{"result": "success"})
}
