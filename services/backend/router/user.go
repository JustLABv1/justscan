package router

import (
	"justscan-backend/handlers/users"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func User(router *gin.RouterGroup, db *bun.DB) {
	user := router.Group("/user").Use(middlewares.Auth(db))
	{
		user.GET("/", func(c *gin.Context) {
			users.GetUserDetails(c, db)
		})

		user.PUT("/", func(c *gin.Context) {
			users.ChangeUserDetails(c, db)
		})
		user.PUT("/password", func(c *gin.Context) {
			users.ChangeUserPassword(c, db)
		})
		user.PUT("/disable", func(c *gin.Context) {
			users.DisableUser(c, db)
		})

		user.DELETE("/", func(c *gin.Context) {
			users.DeleteUser(c, db)
		})

		user.GET("/tokens", func(c *gin.Context) {
			users.ListUserTokens(c, db)
		})
		user.POST("/tokens", func(c *gin.Context) {
			users.CreateUserToken(c, db)
		})
		user.DELETE("/tokens/:tokenId", func(c *gin.Context) {
			users.RevokeUserToken(c, db)
		})
	}
}
