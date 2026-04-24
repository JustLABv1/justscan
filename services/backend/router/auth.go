package router

import (
	"justscan-backend/handlers/auths"
	"justscan-backend/handlers/tokens"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func Auth(router *gin.RouterGroup, db *bun.DB) {
	auth := router.Group("/auth")
	{
		auth.Use(func(c *gin.Context) {
			c.Set("db", db)
			c.Next()
		})

		auth.GET("/setup/status", auths.SetupStatus(db))
		auth.GET("/setup/session", auths.SetupSessionStatus(db))
		auth.POST("/setup/session", auths.StartSetupSession(db))
		auth.POST("/setup/initial-admin", auths.CreateInitialAdmin(db))

		auth.POST("/login", func(c *gin.Context) {
			tokens.GenerateTokenUser(db, c)
		})
		auth.POST("/register", middlewares.AuthRegisterRateLimit(), func(c *gin.Context) {
			auths.RegisterUser(c, db)
		})
		auth.POST("/user/taken", func(c *gin.Context) {
			auths.CheckUserTaken(c, db)
		})

		// OIDC endpoints (legacy single-provider – kept for backwards compatibility)
		auth.GET("/oidc/available", auths.OIDCAvailable)
		auth.GET("/oidc/login", middlewares.AuthRegisterRateLimit(), auths.OIDCLogin)
		auth.GET("/oidc/callback", auths.OIDCCallback(db))

		// Multi-provider OIDC endpoints
		auth.GET("/oidc/providers", auths.OIDCProviders)
		auth.GET("/oidc/:provider/login", middlewares.AuthRegisterRateLimit(), auths.OIDCLoginForProvider)
		auth.GET("/oidc/:provider/callback", auths.OIDCCallbackMulti(db))
	}
}
