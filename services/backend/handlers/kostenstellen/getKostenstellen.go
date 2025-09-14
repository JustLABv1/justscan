package kostenstellen

import (
	"net/http"

	"justwms/functions/httperror"
	"justwms/pkg/models"

	_ "github.com/lib/pq"
	"github.com/uptrace/bun"

	"github.com/gin-gonic/gin"
)

func GetKostenstellen(context *gin.Context, db *bun.DB) {
	var kostenstellen []models.Kostenstellen
	err := db.NewSelect().Model(&kostenstellen).Scan(context)
	if err != nil {
		httperror.InternalServerError(context, "Error collecting kostenstellen data from db", err)
		return
	}

	context.JSON(http.StatusOK, gin.H{"result": "success", "kostenstellen": kostenstellen})
}
