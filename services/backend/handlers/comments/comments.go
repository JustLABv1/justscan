package comments

import (
	"net/http"
	"time"

	"justscan-backend/functions/auth"
	scanhandlers "justscan-backend/handlers/scans"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func CreateComment(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		vulnID, err := uuid.Parse(c.Param("vulnId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vulnerability ID"})
			return
		}

		if _, _, _, ok := scanhandlers.LoadAuthorizedScan(c, db, scanID); !ok {
			return
		}

		userID, err := auth.GetUserIDFromToken(c.GetHeader("Authorization"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		var body struct {
			Content string `json:"content" binding:"required"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "content is required"})
			return
		}

		comment := &models.Comment{
			VulnerabilityID: vulnID,
			ScanID:          scanID,
			UserID:          userID,
			Content:         body.Content,
			CreatedAt:       time.Now(),
			UpdatedAt:       time.Now(),
		}
		if _, err := db.NewInsert().Model(comment).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create comment"})
			return
		}
		c.JSON(http.StatusCreated, comment)
	}
}

func UpdateComment(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		commentID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid comment ID"})
			return
		}

		userID, err := auth.GetUserIDFromToken(c.GetHeader("Authorization"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		var body struct {
			Content string `json:"content" binding:"required"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "content is required"})
			return
		}

		comment := &models.Comment{}
		if err := db.NewSelect().Model(comment).Where("id = ?", commentID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "comment not found"})
			return
		}
		if comment.UserID != userID {
			c.JSON(http.StatusForbidden, gin.H{"error": "cannot edit another user's comment"})
			return
		}

		comment.Content = body.Content
		comment.UpdatedAt = time.Now()
		if _, err := db.NewUpdate().Model(comment).Column("content", "updated_at").Where("id = ?", commentID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update comment"})
			return
		}
		c.JSON(http.StatusOK, comment)
	}
}

func DeleteComment(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		commentID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid comment ID"})
			return
		}

		userID, isAdmin, err := auth.ResolveUserAccess(c.GetHeader("Authorization"), db)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		comment := &models.Comment{}
		if err := db.NewSelect().Model(comment).Where("id = ?", commentID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "comment not found"})
			return
		}
		if comment.UserID != userID && !isAdmin {
			c.JSON(http.StatusForbidden, gin.H{"error": "cannot delete another user's comment"})
			return
		}

		if _, err := db.NewDelete().Model(comment).Where("id = ?", commentID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete comment"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}
