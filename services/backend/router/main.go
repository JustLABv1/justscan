package router

import (
	"justscan-backend/config"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"

	log "github.com/sirupsen/logrus"
)

func StartRouter(db *bun.DB, port int, config *config.RestfulConf) *http.Server {
	gin.SetMode(gin.ReleaseMode)
	router := gin.Default()
	Swagger(router)

	allowOrigins := config.AllowOrigins
	if len(allowOrigins) == 0 {
		allowOrigins = []string{"http://localhost:3000", "http://localhost:4000"}
	}
	router.Use(cors.New(cors.Config{
		AllowOrigins:     allowOrigins,
		AllowMethods:     []string{"GET", "HEAD", "POST", "PUT", "OPTIONS", "DELETE"},
		AllowHeaders:     []string{"Origin", "Authorization", "X-Requested-With", "Content-Type"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	v1 := router.Group("/api/v1")
	{
		Auth(v1, db)
		Token(v1, db)
		User(v1, db)
		Health(v1)
		Admin(v1, db)
		Scans(v1, db)
		Helm(v1, db)
		Dashboard(v1, db)
		Comments(v1, db)
		Suppressions(v1, db)
		Tags(v1, db)
		Registries(v1, db)
		Watchlist(v1, db)
		VulnKB(v1, db)
		Orgs(v1, db)
		PublicScan(v1, db)
		SharedScans(v1, db)
		AutoTags(v1, db)
		StatusPages(v1, db)
	}

	server := &http.Server{
		Addr:    ":" + strconv.Itoa(port),
		Handler: router,
	}

	go func() {
		log.Info("Starting Router on port ", strconv.Itoa(port))
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v\n", err)
		}
	}()

	return server
}
