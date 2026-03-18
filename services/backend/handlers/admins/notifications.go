package admins

import (
	"net/http"
	"time"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// ListNotificationChannels returns all notification channels.
func ListNotificationChannels(c *gin.Context, db *bun.DB) {
	var channels []models.NotificationChannel
	if err := db.NewSelect().Model(&channels).OrderExpr("created_at DESC").Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load channels"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": channels})
}

// CreateNotificationChannel creates a new notification channel.
func CreateNotificationChannel(c *gin.Context, db *bun.DB) {
	var ch models.NotificationChannel
	if err := c.ShouldBindJSON(&ch); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
		return
	}
	ch.ID = uuid.Nil // let DB generate
	ch.CreatedAt = time.Now()
	ch.UpdatedAt = time.Now()

	if _, err := db.NewInsert().Model(&ch).Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create channel"})
		return
	}
	c.JSON(http.StatusCreated, ch)
}

// UpdateNotificationChannel updates an existing notification channel.
func UpdateNotificationChannel(c *gin.Context, db *bun.DB) {
	id := c.Param("channelID")
	var ch models.NotificationChannel
	if err := c.ShouldBindJSON(&ch); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
		return
	}
	ch.UpdatedAt = time.Now()

	if _, err := db.NewUpdate().Model(&ch).
		Column("name", "type", "config", "enabled", "events", "updated_at").
		Where("id = ?", id).
		Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update channel"})
		return
	}
	c.JSON(http.StatusOK, ch)
}

// DeleteNotificationChannel deletes a notification channel.
func DeleteNotificationChannel(c *gin.Context, db *bun.DB) {
	id := c.Param("channelID")
	if _, err := db.NewDelete().Model((*models.NotificationChannel)(nil)).Where("id = ?", id).Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete channel"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"result": "deleted"})
}
