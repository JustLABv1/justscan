package users

import (
	"net/http"
	"time"

	"justscan-backend/functions/auth"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func CreateUserToken(c *gin.Context, db *bun.DB) {
	userID, _, ok := authz.RequireRequestUser(c, db)
	if !ok {
		return
	}

	var body struct {
		Description string `json:"description" binding:"required"`
		ExpiresIn   int    `json:"expires_in"` // seconds; 0 = no expiry (5 years)
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var expiresAt time.Time
	if body.ExpiresIn > 0 {
		expiresAt = time.Now().Add(time.Duration(body.ExpiresIn) * time.Second)
	} else {
		expiresAt = time.Now().Add(5 * 365 * 24 * time.Hour)
	}

	tokenString, err := auth.GeneratePersonalToken(userID, expiresAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	token := models.Tokens{
		UserID:      userID.String(),
		Key:         tokenString,
		Description: body.Description,
		Type:        "personal",
		ExpiresAt:   expiresAt,
		CreatedAt:   time.Now(),
	}
	if _, err := db.NewInsert().Model(&token).Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store token"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":          token.ID,
		"key":         token.Key,
		"description": token.Description,
		"expires_at":  token.ExpiresAt,
		"created_at":  token.CreatedAt,
	})
}
