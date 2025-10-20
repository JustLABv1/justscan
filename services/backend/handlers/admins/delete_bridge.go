package admins

import (
	"justwms-backend/functions/httperror"
	"justwms-backend/pkg/models"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func DeleteBridge(context *gin.Context, db *bun.DB) {
	bridgeID := context.Param("bridgeID")

	_, err := db.NewDelete().Model(&models.CSVBridge{}).Where("id = ?", bridgeID).Exec(context)
	if err != nil {
		httperror.InternalServerError(context, "Error deleting Bridge on db", err)
		return
	}

	// search for bridge tokens and delete them
	_, err = db.NewDelete().Model(&models.Tokens{}).Where("description LIKE ?", "%"+bridgeID+"%").Exec(context)
	if err != nil {
		httperror.InternalServerError(context, "Error deleting Bridge tokens on db", err)
		return
	}

	context.JSON(http.StatusOK, gin.H{"result": "success"})
}
