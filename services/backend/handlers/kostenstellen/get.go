package kostenstellen

import (
	"net/http"

	"github.com/JustNZ/JustWMS/services/backend/functions/httperror"
	"github.com/JustNZ/JustWMS/services/backend/pkg/models"

	_ "github.com/lib/pq"
	"github.com/uptrace/bun"

	"github.com/gin-gonic/gin"
)

func GetKostenstellen(context *gin.Context, db *bun.DB) {
	kostenstellen := make([]models.Kostenstellen, 0)
	err := db.NewSelect().Model(&kostenstellen).Scan(context)
	if err != nil {
		httperror.InternalServerError(context, "Error collecting kostenstellen data from db", err)
		return
	}

	context.JSON(http.StatusOK, gin.H{"result": "success", "kostenstellen": kostenstellen})
}
