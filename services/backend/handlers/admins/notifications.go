package admins

import (
	"io"
	"net/http"
	"strconv"
	"time"

	"justscan-backend/notifications"
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

func TestNotificationChannel(c *gin.Context, db *bun.DB) {
	id := c.Param("channelID")
	channel := &models.NotificationChannel{}
	if err := db.NewSelect().Model(channel).Where("id = ?", id).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "channel not found"})
		return
	}

	var body struct {
		Event string `json:"event"`
	}
	if err := c.ShouldBindJSON(&body); err != nil && err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
		return
	}

	event := body.Event
	if event == "" {
		if len(channel.Events) > 0 {
			event = channel.Events[0]
		} else {
			event = models.NotificationEventScanComplete
		}
	}

	if err := notifications.SendTest(db, *channel, event); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"result": "sent"})
}

func ListNotificationDeliveries(c *gin.Context, db *bun.DB) {
	id := c.Param("channelID")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
	if limit < 1 || limit > 100 {
		limit = 10
	}

	var deliveries []models.NotificationDelivery
	if err := db.NewSelect().
		TableExpr("notification_delivery_logs AS ndl").
		ColumnExpr("ndl.*, nc.name AS channel_name").
		Join("JOIN notification_channels nc ON nc.id = ndl.channel_id").
		Where("ndl.channel_id = ?", id).
		OrderExpr("ndl.created_at DESC").
		Limit(limit).
		Scan(c.Request.Context(), &deliveries); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load delivery history"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": deliveries})
}
