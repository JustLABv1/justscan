package middlewares

import (
	"context"
	"strings"
	"time"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// skipAPILogPrefixes lists path prefixes that should never be recorded in api_request_logs.
var skipAPILogPrefixes = []string{
	"/api/v1/health",
	"/api/v1/public/",
}

// RequestLog returns a Gin middleware that records every API call to api_request_logs.
// Recording is done asynchronously so it never delays the response.
func RequestLog(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		duration := time.Since(start)

		path := c.FullPath() // route pattern, e.g. /api/v1/scans/:id — no cardinality explosion
		if path == "" {
			path = c.Request.URL.Path // fallback for unmatched routes
		}

		// Skip health and public endpoints.
		for _, prefix := range skipAPILogPrefixes {
			if strings.HasPrefix(path, prefix) {
				return
			}
		}

		method := c.Request.Method
		statusCode := c.Writer.Status()
		durationMs := int(duration.Milliseconds())

		// Resolve user_id if authenticated.
		var userID *string
		if raw, exists := c.Get(AuthContextUserIDKey); exists {
			if uid, ok := raw.(uuid.UUID); ok {
				s := uid.String()
				userID = &s
			}
		}

		go func() {
			entry := &models.APIRequestLog{
				UserID:     userID,
				Method:     method,
				Path:       path,
				StatusCode: statusCode,
				DurationMs: durationMs,
			}
			if _, err := db.NewInsert().Model(entry).Exec(context.Background()); err != nil {
				log.Debugf("request_log: failed to record API request: %v", err)
			}
		}()
	}
}
