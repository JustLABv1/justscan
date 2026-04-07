package httperror

import (
	"net/http"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

func InternalServerError(context *gin.Context, message string, err error) {
	errorMessage := "Unknown error"
	if err != nil {
		errorMessage = err.Error()
	}

	log.WithFields(log.Fields{
		"method": context.Request.Method,
		"path":   context.Request.URL.Path,
		"error":  errorMessage,
	}).Error(message)

	context.JSON(http.StatusInternalServerError, gin.H{"message": message, "error": errorMessage})
}
