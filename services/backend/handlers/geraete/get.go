package geraete

import (
	"net/http"

	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"

	_ "github.com/lib/pq"
	"github.com/uptrace/bun"

	"github.com/gin-gonic/gin"
)

func GetGeraete(context *gin.Context, db *bun.DB) {
	geraete := make([]models.Geraete, 0)
	err := db.NewSelect().Model(&geraete).Scan(context)
	if err != nil {
		httperror.InternalServerError(context, "Error collecting geraete data from db", err)
		return
	}

	context.JSON(http.StatusOK, gin.H{"result": "success", "geraete": geraete})
}
