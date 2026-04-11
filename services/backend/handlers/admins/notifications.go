package admins

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
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
	if err := validateNotificationChannel(ch); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if _, err := db.NewInsert().Model(&ch).Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create channel"})
		return
	}
	c.JSON(http.StatusCreated, ch)
}

// UpdateNotificationChannel updates an existing notification channel.
func UpdateNotificationChannel(c *gin.Context, db *bun.DB) {
	id := c.Param("channelID")
	existing := &models.NotificationChannel{}
	if err := db.NewSelect().Model(existing).Where("id = ?", id).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "channel not found"})
		return
	}
	var body struct {
		Name          *string                    `json:"name"`
		Type          *string                    `json:"type"`
		Config        *models.NotificationConfig `json:"config"`
		Enabled       *bool                      `json:"enabled"`
		Events        *[]string                  `json:"events"`
		OrgIDs        *[]string                  `json:"org_ids"`
		ImagePatterns *[]string                  `json:"image_patterns"`
		MinSeverity   *string                    `json:"min_severity"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
		return
	}
	if body.Name != nil {
		existing.Name = *body.Name
	}
	if body.Type != nil {
		existing.Type = *body.Type
	}
	if body.Config != nil {
		if existing.Type == models.NotificationTypeEmail && body.Config.SMTPPassword == "" {
			body.Config.SMTPPassword = existing.Config.SMTPPassword
		}
		if existing.Type == models.NotificationTypeTelegram && body.Config.TelegramBotToken == "" {
			body.Config.TelegramBotToken = existing.Config.TelegramBotToken
		}
		existing.Config = *body.Config
	}
	if body.Enabled != nil {
		existing.Enabled = *body.Enabled
	}
	if body.Events != nil {
		existing.Events = *body.Events
	}
	if body.OrgIDs != nil {
		existing.OrgIDs = *body.OrgIDs
	}
	if body.ImagePatterns != nil {
		existing.ImagePatterns = *body.ImagePatterns
	}
	if body.MinSeverity != nil {
		existing.MinSeverity = *body.MinSeverity
	}
	existing.UpdatedAt = time.Now()
	if err := validateNotificationChannel(*existing); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if _, err := db.NewUpdate().Model(existing).
		Column("name", "type", "config", "enabled", "events", "org_ids", "image_patterns", "min_severity", "updated_at").
		Where("id = ?", id).
		Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update channel"})
		return
	}
	c.JSON(http.StatusOK, existing)
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

func validateNotificationChannel(ch models.NotificationChannel) error {
	ch.Name = strings.TrimSpace(ch.Name)
	ch.Type = strings.TrimSpace(ch.Type)
	ch.MinSeverity = strings.ToUpper(strings.TrimSpace(ch.MinSeverity))
	if ch.Name == "" {
		return fmt.Errorf("channel name is required")
	}
	if !isAllowedChannelType(ch.Type) {
		return fmt.Errorf("unsupported notification channel type %q", ch.Type)
	}
	if len(ch.Events) == 0 {
		return fmt.Errorf("at least one event subscription is required")
	}
	for _, event := range ch.Events {
		if !isAllowedNotificationEvent(event) {
			return fmt.Errorf("unsupported notification event %q", event)
		}
	}
	for _, orgID := range ch.OrgIDs {
		if _, err := uuid.Parse(strings.TrimSpace(orgID)); err != nil {
			return fmt.Errorf("invalid org id %q", orgID)
		}
	}
	if ch.MinSeverity != "" && !isAllowedSeverity(ch.MinSeverity) {
		return fmt.Errorf("unsupported minimum severity %q", ch.MinSeverity)
	}
	return validateNotificationConfig(ch.Type, ch.Config)
}

func validateNotificationConfig(channelType string, cfg models.NotificationConfig) error {
	switch channelType {
	case models.NotificationTypeDiscord, models.NotificationTypeWebhook, models.NotificationTypeSlack, models.NotificationTypeTeams:
		if strings.TrimSpace(cfg.WebhookURL) == "" {
			return fmt.Errorf("webhook URL is required")
		}
	case models.NotificationTypeEmail:
		if strings.TrimSpace(cfg.SMTPHost) == "" {
			return fmt.Errorf("SMTP host is required")
		}
		if strings.TrimSpace(cfg.SMTPFrom) == "" {
			return fmt.Errorf("SMTP from address is required")
		}
		if len(cfg.ToAddresses) == 0 {
			return fmt.Errorf("at least one recipient address is required")
		}
	case models.NotificationTypeTelegram:
		if strings.TrimSpace(cfg.TelegramBotToken) == "" {
			return fmt.Errorf("telegram bot token is required")
		}
		if strings.TrimSpace(cfg.TelegramChatID) == "" {
			return fmt.Errorf("telegram chat id is required")
		}
	default:
		return fmt.Errorf("unsupported notification channel type %q", channelType)
	}
	return nil
}

func isAllowedChannelType(channelType string) bool {
	switch channelType {
	case models.NotificationTypeDiscord, models.NotificationTypeEmail, models.NotificationTypeWebhook, models.NotificationTypeSlack, models.NotificationTypeTeams, models.NotificationTypeTelegram:
		return true
	default:
		return false
	}
}

func isAllowedNotificationEvent(event string) bool {
	switch event {
	case models.NotificationEventScanComplete, models.NotificationEventScanFailed, models.NotificationEventComplianceFailed:
		return true
	default:
		return false
	}
}

func isAllowedSeverity(severity string) bool {
	switch strings.ToUpper(strings.TrimSpace(severity)) {
	case models.SeverityCritical, models.SeverityHigh, models.SeverityMedium, models.SeverityLow, models.SeverityUnknown:
		return true
	default:
		return false
	}
}
