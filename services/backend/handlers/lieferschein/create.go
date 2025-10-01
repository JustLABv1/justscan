package lieferschein

import (
	"net/http"

	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
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

	context.JSON(http.StatusCreated, gin.H{"result": "success"})
}
