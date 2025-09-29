package bestellungen

import (
	"justwms/functions/httperror"
	"justwms/pkg/models"
	"net/http"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
	"github.com/uptrace/bun"
)

func DeleteBestellung(context *gin.Context, db *bun.DB) {
	bestellungID := context.Param("id")

	_, err := db.NewDelete().Model(&models.Bestellungen{}).Where("id = ?", bestellungID).Exec(context)
	if err != nil {
		httperror.InternalServerError(context, "Error deleting bestellung on db", err)
		return
	}

	context.JSON(http.StatusOK, gin.H{"result": "success"})
}
