package bestellungen

import (
	"justwms/functions/httperror"
	"justwms/pkg/models"
	"net/http"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
	"github.com/uptrace/bun"
)

func UpdateBestellung(context *gin.Context, db *bun.DB) {
	bestellungID := context.Param("id")

	var bestellung models.Bestellungen
	if err := context.ShouldBindJSON(&bestellung); err != nil {
		httperror.StatusBadRequest(context, "Error parsing incoming data", err)
		return
	}

	columns := []string{}
	if bestellung.Status != "" {
		columns = append(columns, "status")
	}

	_, err := db.NewUpdate().Model(&bestellung).Column(columns...).Where("id = ?", bestellungID).Exec(context)
	if err != nil {
		httperror.InternalServerError(context, "Error updating bestellung on db", err)
		return
	}

	context.JSON(http.StatusCreated, gin.H{"result": "success"})
}
