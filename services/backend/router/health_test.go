package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"justscan-backend/config"

	"github.com/gin-gonic/gin"
)

func TestHealthRoutesExposeLivenessAndCompatibility(t *testing.T) {
	previous := config.Config
	config.Config = &config.RestfulConf{Scanner: config.ScannerConf{EnableTrivy: false}}
	t.Cleanup(func() { config.Config = previous })

	gin.SetMode(gin.TestMode)
	router := gin.New()
	Health(router.Group("/api/v1"))
	for _, path := range []string{"/api/v1/health", "/api/v1/livez"} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, path, nil)
		router.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d, want 200", path, recorder.Code)
		}
	}
}

func TestReadyzWithoutDatabaseIsNotReady(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	Health(router.Group("/api/v1"))
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/readyz", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("readyz status = %d, want 503", recorder.Code)
	}
}
