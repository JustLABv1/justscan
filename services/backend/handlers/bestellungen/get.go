package bestellungen

import (
	"net/http"

	"justwms/functions/httperror"
	"justwms/pkg/models"

	_ "github.com/lib/pq"
	"github.com/uptrace/bun"

	"github.com/gin-gonic/gin"
)

func GetBestellungen(context *gin.Context, db *bun.DB) {
	bestellungen := make([]models.Bestellungen, 0)
	err := db.NewSelect().Model(&bestellungen).Scan(context)
	if err != nil {
		httperror.InternalServerError(context, "Error collecting bestellungen data from db", err)
		return
	}

	context.JSON(http.StatusOK, gin.H{"result": "success", "bestellungen": bestellungen})
}
