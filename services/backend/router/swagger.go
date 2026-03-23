package router

import (
	"net/http"

	"justscan-backend/docs"

	"github.com/gin-gonic/gin"
	swaggerfiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

func Swagger(router *gin.Engine) {
	router.GET("/api/v1/swagger/doc.json", func(c *gin.Context) {
		c.JSON(http.StatusOK, docs.OpenAPISpec(router.Routes()))
	})
	router.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerfiles.Handler, ginSwagger.URL("/api/v1/swagger/doc.json")))
}
