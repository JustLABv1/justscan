package artikel

import (
	"net/http"

	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"

	_ "github.com/lib/pq"
	"github.com/uptrace/bun"

	"github.com/gin-gonic/gin"
)

func GetArtikel(context *gin.Context, db *bun.DB) {
	artikel := make([]models.Artikel, 0)
	err := db.NewSelect().Model(&artikel).Scan(context)
	if err != nil {
		httperror.InternalServerError(context, "Error collecting artikel data from db", err)
		return
	}

	context.JSON(http.StatusOK, gin.H{"result": "success", "artikel": artikel})
}
