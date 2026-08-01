package notifications

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"justscan-backend/functions/auth"
	"justscan-backend/functions/authz"
	notificationservice "justscan-backend/notifications"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Scope struct {
	Type string
	Ref  string
}

func SystemScope() Scope {
	return Scope{Type: models.NotificationScopeSystem, Ref: ""}
}

func OrgScope(orgID uuid.UUID) Scope {
	return Scope{Type: models.NotificationScopeOrg, Ref: orgID.String()}
}

func UserScope(userID uuid.UUID) Scope {
	return Scope{Type: models.NotificationScopeUser, Ref: userID.String()}
}

func RequireOrgAdminScope(c *gin.Context, db *bun.DB) (Scope, bool) {
	orgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org id"})
		return Scope{}, false
	}
	if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin); !ok {
		return Scope{}, false
	}
	return OrgScope(orgID), true
}

func RequireOrgViewerScope(c *gin.Context, db *bun.DB) (Scope, bool) {
	orgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org id"})
		return Scope{}, false
	}
	if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleViewer); !ok {
		return Scope{}, false
	}
	return OrgScope(orgID), true
}

func RequireUserScope(c *gin.Context) (Scope, bool) {
	userID, err := auth.GetUserIDFromToken(c.GetHeader("Authorization"))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return Scope{}, false
	}
	return UserScope(userID), true
}

func ListChannels(c *gin.Context, db *bun.DB, scope Scope) {
	var channels []models.NotificationChannel
	if err := db.NewSelect().
		Model(&channels).
		Where("scope_type = ?", scope.Type).
		Where("scope_ref = ?", scope.Ref).
		OrderExpr("created_at DESC").
		Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load channels"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": channels})
}

func CreateChannel(c *gin.Context, db *bun.DB, scope Scope) {
	var channel models.NotificationChannel
	if err := c.ShouldBindJSON(&channel); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
		return
	}
	channel.ID = uuid.Nil
	channel.ScopeType = scope.Type
	channel.ScopeRef = scope.Ref
	channel.CreatedAt = time.Now().UTC()
	channel.UpdatedAt = time.Now().UTC()
	if err := validateNotificationChannel(channel); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if _, err := db.NewInsert().Model(&channel).Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create channel"})
		return
	}
	c.JSON(http.StatusCreated, channel)
}

func UpdateChannel(c *gin.Context, db *bun.DB, scope Scope) {
	channelID, err := uuid.Parse(c.Param("channelID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid channel id"})
		return
	}
	channel := &models.NotificationChannel{}
	if err := db.NewSelect().
		Model(channel).
		Where("id = ?", channelID).
		Where("scope_type = ?", scope.Type).
		Where("scope_ref = ?", scope.Ref).
		Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "channel not found"})
		return
	}

	var body struct {
		Name    *string                    `json:"name"`
		Type    *string                    `json:"type"`
		Config  *models.NotificationConfig `json:"config"`
		Enabled *bool                      `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
		return
	}

	if body.Name != nil {
		channel.Name = *body.Name
	}
	if body.Type != nil {
		channel.Type = *body.Type
	}
	if body.Config != nil {
		if channel.Type == models.NotificationTypeEmail && body.Config.SMTPPassword == "" {
			body.Config.SMTPPassword = channel.Config.SMTPPassword
		}
		if channel.Type == models.NotificationTypeTelegram && body.Config.TelegramBotToken == "" {
			body.Config.TelegramBotToken = channel.Config.TelegramBotToken
		}
		channel.Config = *body.Config
	}
	if body.Enabled != nil {
		channel.Enabled = *body.Enabled
	}
	channel.ScopeType = scope.Type
	channel.ScopeRef = scope.Ref
	channel.UpdatedAt = time.Now().UTC()
	if err := validateNotificationChannel(*channel); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if _, err := db.NewUpdate().
		Model(channel).
		Column("name", "type", "config", "enabled", "updated_at").
		Where("id = ?", channel.ID).
		Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update channel"})
		return
	}
	c.JSON(http.StatusOK, channel)
}

func DeleteChannel(c *gin.Context, db *bun.DB, scope Scope) {
	channelID, err := uuid.Parse(c.Param("channelID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid channel id"})
		return
	}
	if _, err := db.NewDelete().
		Model((*models.NotificationChannel)(nil)).
		Where("id = ?", channelID).
		Where("scope_type = ?", scope.Type).
		Where("scope_ref = ?", scope.Ref).
		Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete channel"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"result": "deleted"})
}

func TestChannel(c *gin.Context, db *bun.DB, scope Scope) {
	channelID, err := uuid.Parse(c.Param("channelID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid channel id"})
		return
	}
	channel := &models.NotificationChannel{}
	if err := db.NewSelect().
		Model(channel).
		Where("id = ?", channelID).
		Where("scope_type = ?", scope.Type).
		Where("scope_ref = ?", scope.Ref).
		Scan(c.Request.Context()); err != nil {
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
	event := strings.TrimSpace(body.Event)
	if event == "" {
		event = models.NotificationEventScanComplete
	}
	if err := notificationservice.SendTest(db, *channel, event); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"result": "sent"})
}

func ListRules(c *gin.Context, db *bun.DB, scope Scope) {
	var rules []models.NotificationRule
	if err := db.NewSelect().
		Model(&rules).
		Where("scope_type = ?", scope.Type).
		Where("scope_ref = ?", scope.Ref).
		OrderExpr("created_at DESC").
		Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load rules"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rules})
}

func CreateRule(c *gin.Context, db *bun.DB, scope Scope) {
	var rule models.NotificationRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
		return
	}
	rule.ID = uuid.Nil
	rule.ScopeType = scope.Type
	rule.ScopeRef = scope.Ref
	rule.CreatedAt = time.Now().UTC()
	rule.UpdatedAt = time.Now().UTC()
	if err := validateNotificationRule(c.Request.Context(), db, scope, rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if _, err := db.NewInsert().Model(&rule).Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create rule"})
		return
	}
	c.JSON(http.StatusCreated, rule)
}

func UpdateRule(c *gin.Context, db *bun.DB, scope Scope) {
	ruleID, err := uuid.Parse(c.Param("ruleID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule id"})
		return
	}
	rule := &models.NotificationRule{}
	if err := db.NewSelect().
		Model(rule).
		Where("id = ?", ruleID).
		Where("scope_type = ?", scope.Type).
		Where("scope_ref = ?", scope.Ref).
		Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
		return
	}
	if err := c.ShouldBindJSON(rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
		return
	}
	rule.ID = ruleID
	rule.ScopeType = scope.Type
	rule.ScopeRef = scope.Ref
	rule.UpdatedAt = time.Now().UTC()
	if err := validateNotificationRule(c.Request.Context(), db, scope, *rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if _, err := db.NewUpdate().
		Model(rule).
		Column("name", "enabled", "channel_ids", "event_types", "conditions", "delivery_mode", "digest_window_minutes", "updated_at").
		Where("id = ?", rule.ID).
		Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update rule"})
		return
	}
	c.JSON(http.StatusOK, rule)
}

func DeleteRule(c *gin.Context, db *bun.DB, scope Scope) {
	ruleID, err := uuid.Parse(c.Param("ruleID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule id"})
		return
	}
	if _, err := db.NewDelete().
		Model((*models.NotificationRule)(nil)).
		Where("id = ?", ruleID).
		Where("scope_type = ?", scope.Type).
		Where("scope_ref = ?", scope.Ref).
		Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete rule"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"result": "deleted"})
}

func ListDeliveries(c *gin.Context, db *bun.DB, scope Scope) {
	limit := normalizeLimit(c.DefaultQuery("limit", "25"), 25, 200)
	var deliveries []models.NotificationDelivery
	if err := db.NewSelect().
		TableExpr("notification_delivery_logs ndl").
		ColumnExpr("ndl.*, nc.name AS channel_name, nr.name AS rule_name").
		Join("JOIN notification_channels nc ON nc.id = ndl.channel_id").
		Join("LEFT JOIN notification_rules nr ON nr.id = ndl.rule_id").
		Where("ndl.scope_type = ?", scope.Type).
		Where("ndl.scope_ref = ?", scope.Ref).
		OrderExpr("ndl.created_at DESC").
		Limit(limit).
		Scan(c.Request.Context(), &deliveries); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load deliveries"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": deliveries})
}

func ListQueue(c *gin.Context, db *bun.DB, scope Scope) {
	limit := normalizeLimit(c.DefaultQuery("limit", "50"), 50, 200)
	var jobs []models.NotificationQueueJob
	if err := db.NewSelect().
		TableExpr("notification_queue_jobs nqj").
		ColumnExpr("nqj.*, nc.name AS channel_name, nr.name AS rule_name").
		Join("JOIN notification_channels nc ON nc.id = nqj.channel_id").
		Join("JOIN notification_rules nr ON nr.id = nqj.rule_id").
		Where("nqj.scope_type = ?", scope.Type).
		Where("nqj.scope_ref = ?", scope.Ref).
		Where("nqj.status != ?", models.NotificationQueueStatusDelivered).
		OrderExpr("nqj.created_at DESC").
		Limit(limit).
		Scan(c.Request.Context(), &jobs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load queue jobs"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": jobs})
}

func RetryQueueJob(c *gin.Context, db *bun.DB, scope Scope) {
	jobID, err := uuid.Parse(c.Param("jobID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid job id"})
		return
	}
	if _, err := db.NewUpdate().
		Model((*models.NotificationQueueJob)(nil)).
		Set("status = ?", models.NotificationQueueStatusPending).
		Set("attempt_count = 0").
		Set("last_error = ''").
		Set("next_attempt_at = ?", time.Now().UTC()).
		Set("lease_owner = ''").
		Set("leased_until = NULL").
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ?", jobID).
		Where("scope_type = ?", scope.Type).
		Where("scope_ref = ?", scope.Ref).
		Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to retry queue job"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"result": "queued"})
}

func normalizeLimit(raw string, fallback int, max int) int {
	limit, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || limit <= 0 {
		return fallback
	}
	if limit > max {
		return max
	}
	return limit
}

func validateNotificationChannel(channel models.NotificationChannel) error {
	channel.Name = strings.TrimSpace(channel.Name)
	channel.Type = strings.TrimSpace(channel.Type)
	if channel.Name == "" {
		return fmt.Errorf("channel name is required")
	}
	if !isAllowedChannelType(channel.Type) {
		return fmt.Errorf("unsupported notification channel type %q", channel.Type)
	}
	return validateNotificationConfig(channel.Type, channel.Config)
}

func validateNotificationRule(ctx context.Context, db *bun.DB, scope Scope, rule models.NotificationRule) error {
	rule.Name = strings.TrimSpace(rule.Name)
	if rule.Name == "" {
		return fmt.Errorf("rule name is required")
	}
	if len(rule.ChannelIDs) == 0 {
		return fmt.Errorf("at least one channel is required")
	}
	if len(rule.EventTypes) == 0 {
		return fmt.Errorf("at least one event type is required")
	}
	for _, eventType := range rule.EventTypes {
		if !isAllowedNotificationEvent(eventType) {
			return fmt.Errorf("unsupported event type %q", eventType)
		}
	}
	if rule.DeliveryMode == "" {
		rule.DeliveryMode = models.NotificationDeliveryModeImmediate
	}
	if rule.DeliveryMode != models.NotificationDeliveryModeImmediate && rule.DeliveryMode != models.NotificationDeliveryModeDigest {
		return fmt.Errorf("unsupported delivery mode %q", rule.DeliveryMode)
	}
	if rule.DeliveryMode == models.NotificationDeliveryModeDigest && rule.DigestWindowMinutes <= 0 {
		return fmt.Errorf("digest window minutes must be greater than zero")
	}
	channelIDs := make([]uuid.UUID, 0, len(rule.ChannelIDs))
	for _, rawChannelID := range rule.ChannelIDs {
		channelID, err := uuid.Parse(strings.TrimSpace(rawChannelID))
		if err != nil {
			return fmt.Errorf("invalid channel id %q", rawChannelID)
		}
		channelIDs = append(channelIDs, channelID)
	}
	count, err := db.NewSelect().
		Table("notification_channels").
		Where("scope_type = ?", scope.Type).
		Where("scope_ref = ?", scope.Ref).
		Where("id IN (?)", bun.In(channelIDs)).
		Count(ctx)
	if err != nil {
		return err
	}
	if count != len(rule.ChannelIDs) {
		return fmt.Errorf("one or more channels are missing or outside this scope")
	}
	return nil
}

func validateNotificationConfig(channelType string, cfg models.NotificationConfig) error {
	switch channelType {
	case models.NotificationTypeDiscord, models.NotificationTypeWebhook, models.NotificationTypeSlack, models.NotificationTypeTeams:
		if strings.TrimSpace(cfg.WebhookURL) == "" {
			return fmt.Errorf("webhook URL is required")
		}
	case models.NotificationTypeEmail:
		if strings.TrimSpace(cfg.SMTPHost) == "" || strings.TrimSpace(cfg.SMTPFrom) == "" || len(cfg.ToAddresses) == 0 {
			return fmt.Errorf("email notifications require SMTP host, from address, and recipients")
		}
	case models.NotificationTypeTelegram:
		if strings.TrimSpace(cfg.TelegramBotToken) == "" || strings.TrimSpace(cfg.TelegramChatID) == "" {
			return fmt.Errorf("telegram notifications require bot token and chat id")
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
	case models.NotificationEventIntelligencePolicyImpact:
		return true
	default:
		return false
	}
}
