package middlewares

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func resetLimiterState(rl *ipRateLimiter, limit int) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	rl.limit = limit
	rl.buckets = make(map[string][]time.Time)
}

func TestAuthLoginRateLimitBlocksRepeatedAttempts(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Keep test isolated from global limiter state.
	authLoginLimiter.mu.Lock()
	originalLimit := authLoginLimiter.limit
	authLoginLimiter.mu.Unlock()
	resetLimiterState(authLoginLimiter, 1)
	defer resetLimiterState(authLoginLimiter, originalLimit)

	router := gin.New()
	router.POST("/auth/login", AuthLoginRateLimit(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	firstReq := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	firstReq.RemoteAddr = "203.0.113.10:1234"
	firstResp := httptest.NewRecorder()
	router.ServeHTTP(firstResp, firstReq)
	if firstResp.Code != http.StatusOK {
		t.Fatalf("first request status = %d, want %d", firstResp.Code, http.StatusOK)
	}

	secondReq := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	secondReq.RemoteAddr = "203.0.113.10:1234"
	secondResp := httptest.NewRecorder()
	router.ServeHTTP(secondResp, secondReq)
	if secondResp.Code != http.StatusTooManyRequests {
		t.Fatalf("second request status = %d, want %d", secondResp.Code, http.StatusTooManyRequests)
	}
}
