package backgroundjobs

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	workerjobs "justscan-backend/backgroundjobs"
	"justscan-backend/functions/authz"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// List returns background jobs visible in the caller's personal and
// organization workspaces. The optional scope query parameter accepts
// "personal" or an organization UUID.
func List(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		limit := 0
		if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed < 1 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
				return
			}
			limit = parsed
		}
		scope := strings.TrimSpace(c.Query("scope"))
		if scope != "" && scope != "personal" {
			if _, err := uuid.Parse(scope); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scope"})
				return
			}
		}
		jobs, err := workerjobs.ListAuthorized(c.Request.Context(), db, userID, isAdmin, scope, limit)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load background jobs"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"jobs": jobs})
	}
}

// Get returns one authorized background job. A non-member cannot use a job ID
// to discover work in another personal or organization scope.
func Get(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		jobID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid job id"})
			return
		}
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		job, err := workerjobs.GetAuthorized(c.Request.Context(), db, jobID, userID, isAdmin)
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "background job not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load background job"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"job": job})
	}
}
