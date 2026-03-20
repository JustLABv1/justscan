package dashboard

import (
	"net/http"

	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
)

func GetScannerHealth() gin.HandlerFunc {
	return func(c *gin.Context) {
		report := scanner.GetHealthReport(c.Request.Context())
		c.JSON(http.StatusOK, report)
	}
}
