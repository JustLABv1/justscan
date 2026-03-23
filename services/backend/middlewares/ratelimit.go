package middlewares

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type ipRateLimiter struct {
	mu      sync.Mutex
	buckets map[string][]time.Time
	limit   int
	window  time.Duration
}

var publicScanLimiter = &ipRateLimiter{
	buckets: make(map[string][]time.Time),
	limit:   5,
	window:  time.Hour,
}

var authRegisterLimiter = &ipRateLimiter{
	buckets: make(map[string][]time.Time),
	limit:   10,
	window:  time.Hour,
}

// SetPublicScanRateLimit updates the per-IP hourly limit for public scans.
func SetPublicScanRateLimit(limit int) {
	publicScanLimiter.mu.Lock()
	publicScanLimiter.limit = limit
	publicScanLimiter.mu.Unlock()
}

func SetAuthRegisterRateLimit(limit int) {
	authRegisterLimiter.mu.Lock()
	authRegisterLimiter.limit = limit
	authRegisterLimiter.mu.Unlock()
}

func (rl *ipRateLimiter) check(ip string) (allowed bool, remaining int) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-rl.window)

	prev := rl.buckets[ip]
	kept := prev[:0]
	for _, t := range prev {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}

	if len(kept) >= rl.limit {
		rl.buckets[ip] = kept
		return false, 0
	}

	rl.buckets[ip] = append(kept, now)
	return true, rl.limit - len(kept) - 1
}

func rateLimitMiddleware(rl *ipRateLimiter, errorMessage func(limit int) string) gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		ok, remaining := rl.check(ip)
		if !ok {
			c.Header("Retry-After", strconv.Itoa(int(rl.window.Seconds())))
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":       errorMessage(rl.limit),
				"retry_after": strconv.Itoa(int(rl.window.Seconds())),
			})
			c.Abort()
			return
		}
		c.Header("X-RateLimit-Limit", strconv.Itoa(rl.limit))
		c.Header("X-RateLimit-Remaining", strconv.Itoa(remaining))
		c.Next()
	}
}

// PublicScanRateLimit is a gin middleware that enforces per-IP hourly scan limits.
func PublicScanRateLimit() gin.HandlerFunc {
	return rateLimitMiddleware(publicScanLimiter, func(limit int) string {
		return "rate limit exceeded: you can scan up to " + strconv.Itoa(limit) + " images per hour"
	})
}

func AuthRegisterRateLimit() gin.HandlerFunc {
	return rateLimitMiddleware(authRegisterLimiter, func(limit int) string {
		return "rate limit exceeded: you can create up to " + strconv.Itoa(limit) + " accounts per hour from this IP"
	})
}
