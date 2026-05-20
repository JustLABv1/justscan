package httperror

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func StatusConflict(context *gin.Context, message string, err error) {
	errorMessage := "conflict"
	if err != nil {
		errorMessage = err.Error()
	}
	context.JSON(http.StatusConflict, gin.H{"message": message, "error": errorMessage})
	context.Abort()
}
