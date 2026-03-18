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

// SetPublicScanRateLimit updates the per-IP hourly limit for public scans.
func SetPublicScanRateLimit(limit int) {
	publicScanLimiter.mu.Lock()
	publicScanLimiter.limit = limit
	publicScanLimiter.mu.Unlock()
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

// PublicScanRateLimit is a gin middleware that enforces per-IP hourly scan limits.
func PublicScanRateLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		ok, remaining := publicScanLimiter.check(ip)
		if !ok {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":       "rate limit exceeded: you can scan up to " + strconv.Itoa(publicScanLimiter.limit) + " images per hour",
				"retry_after": "3600",
			})
			c.Abort()
			return
		}
		c.Header("X-RateLimit-Limit", strconv.Itoa(publicScanLimiter.limit))
		c.Header("X-RateLimit-Remaining", strconv.Itoa(remaining))
		c.Next()
	}
}
