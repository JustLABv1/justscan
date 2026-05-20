package httperror

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func Unauthorized(context *gin.Context, message string, err error) {
	errorMessage := "unauthorized"
	if err != nil {
		errorMessage = err.Error()
	}
	context.JSON(http.StatusUnauthorized, gin.H{"message": message, "error": errorMessage})
	context.Abort()
}
