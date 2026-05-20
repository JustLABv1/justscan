package httperror

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func StatusBadRequest(context *gin.Context, message string, err error) {
	errorMessage := "bad request"
	if err != nil {
		errorMessage = err.Error()
	}
	context.JSON(http.StatusBadRequest, gin.H{"message": message, "error": errorMessage})
	context.Abort()
}
