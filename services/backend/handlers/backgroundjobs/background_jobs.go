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

// Dismiss hides a completed or failed job from the current user's Process
// Center. The job record itself remains available for operations and other
// authorized organization members.
func Dismiss(db *bun.DB) gin.HandlerFunc {
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
		if err := workerjobs.DismissAuthorized(c.Request.Context(), db, jobID, userID, isAdmin); err != nil {
			switch {
			case errors.Is(err, sql.ErrNoRows):
				c.JSON(http.StatusNotFound, gin.H{"error": "background job not found"})
			case errors.Is(err, workerjobs.ErrJobNotFinished):
				c.JSON(http.StatusConflict, gin.H{"error": "active background jobs cannot be removed"})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove background job"})
			}
			return
		}
		c.Status(http.StatusNoContent)
	}
}

type dismissManyRequest struct {
	IDs []uuid.UUID `json:"ids"`
}

// DismissMany performs the same user-specific dismissal for the selected
// completed or failed jobs. The client supplies the currently displayed IDs,
// keeping the bulk action explicit and scope-safe.
func DismissMany(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var request dismissManyRequest
		if err := c.ShouldBindJSON(&request); err != nil || len(request.IDs) == 0 || len(request.IDs) > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "provide between 1 and 100 background job ids"})
			return
		}
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		dismissed, err := workerjobs.DismissManyAuthorized(c.Request.Context(), db, request.IDs, userID, isAdmin)
		if err != nil {
			switch {
			case errors.Is(err, sql.ErrNoRows):
				c.JSON(http.StatusNotFound, gin.H{"error": "background job not found"})
			case errors.Is(err, workerjobs.ErrJobNotFinished):
				c.JSON(http.StatusConflict, gin.H{"error": "active background jobs cannot be removed"})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove background jobs"})
			}
			return
		}
		c.JSON(http.StatusOK, gin.H{"dismissed": dismissed})
	}
}
