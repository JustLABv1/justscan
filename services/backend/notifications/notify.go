package notifications

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net/http"
	"net/smtp"
	"regexp"
	"strings"
	"time"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// Payload is the structured event data sent to notification channels.
type Payload struct {
	Event         string            `json:"event"`
	ScanID        string            `json:"scan_id,omitempty"`
	ImageName     string            `json:"image_name,omitempty"`
	ImageTag      string            `json:"image_tag,omitempty"`
	OrgIDs        []string          `json:"org_ids,omitempty"`
	Status        string            `json:"status,omitempty"`
	CriticalCount int               `json:"critical_count,omitempty"`
	HighCount     int               `json:"high_count,omitempty"`
	MediumCount   int               `json:"medium_count,omitempty"`
	LowCount      int               `json:"low_count,omitempty"`
	UnknownCount  int               `json:"unknown_count,omitempty"`
	Details       string            `json:"details,omitempty"`
	Extra         map[string]string `json:"extra,omitempty"`
	Timestamp     time.Time         `json:"timestamp"`
}

// Dispatch sends a notification to all enabled channels subscribed to the given event.
func Dispatch(db *bun.DB, event string, p Payload) {
	p.Timestamp = time.Now()
	p.Event = event

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	enrichPayload(ctx, db, &p)

	var channels []models.NotificationChannel
	if err := db.NewSelect().Model(&channels).Where("enabled = true").Scan(ctx); err != nil {
		log.Warnf("notifications.Dispatch: failed to load channels: %v", err)
		return
	}

	for i := range channels {
		ch := channels[i]
		subscribed := false
		for _, ev := range ch.Events {
			if ev == event {
				subscribed = true
				break
			}
		}
		if !subscribed {
			continue
		}
		if !channelMatches(ch, p) {
			continue
		}
		go func(c models.NotificationChannel) {
			err := sendAndRecord(db, c, p, "dispatch")
			if err != nil {
				log.Warnf("notifications: channel %q (%s) failed: %v", c.Name, c.Type, err)
			}
		}(ch)
	}
}

func SendTest(db *bun.DB, channel models.NotificationChannel, event string) error {
	payload := Payload{
		Event:     event,
		Status:    "test",
		Details:   fmt.Sprintf("Manual test notification for channel %s.", channel.Name),
		Timestamp: time.Now(),
		Extra: map[string]string{
			"source": "admin-test",
		},
	}

	return sendAndRecord(db, channel, payload, "test")
}

func sendAndRecord(db *bun.DB, channel models.NotificationChannel, payload Payload, triggeredBy string) error {
	err := sendToChannel(channel, payload)
	status := "delivered"
	errorMessage := ""
	if err != nil {
		status = "failed"
		errorMessage = err.Error()
	}
	recordDelivery(db, channel.ID, payload.Event, triggeredBy, status, errorMessage, payload.Details)
	return err
}

func sendToChannel(channel models.NotificationChannel, payload Payload) error {
	switch channel.Type {
	case models.NotificationTypeDiscord:
		return sendDiscord(channel.Config, payload)
	case models.NotificationTypeWebhook:
		return sendWebhook(channel.Config, payload)
	case models.NotificationTypeEmail:
		return sendEmail(channel.Config, payload)
	case models.NotificationTypeSlack:
		return sendSlack(channel.Config, payload)
	case models.NotificationTypeTeams:
		return sendTeams(channel.Config, payload)
	case models.NotificationTypeTelegram:
		return sendTelegram(channel.Config, payload)
	default:
		return fmt.Errorf("unsupported notification channel type %q", channel.Type)
	}
}

func enrichPayload(ctx context.Context, db *bun.DB, payload *Payload) {
	if db == nil || payload == nil || payload.ScanID == "" {
		return
	}
	scanID, err := uuid.Parse(payload.ScanID)
	if err != nil {
		return
	}
	scan := &models.Scan{}
	if err := db.NewSelect().Model(scan).Where("id = ?", scanID).Scan(ctx); err == nil {
		if payload.ImageName == "" {
			payload.ImageName = scan.ImageName
		}
		if payload.ImageTag == "" {
			payload.ImageTag = scan.ImageTag
		}
		if payload.Status == "" {
			payload.Status = scan.Status
		}
		if payload.CriticalCount == 0 && payload.HighCount == 0 && payload.MediumCount == 0 && payload.LowCount == 0 && payload.UnknownCount == 0 {
			payload.CriticalCount = scan.CriticalCount
			payload.HighCount = scan.HighCount
			payload.MediumCount = scan.MediumCount
			payload.LowCount = scan.LowCount
			payload.UnknownCount = scan.UnknownCount
		}
	}
	if len(payload.OrgIDs) == 0 {
		var orgScans []models.OrgScan
		if err := db.NewSelect().Model(&orgScans).Where("scan_id = ?", scanID).Scan(ctx); err == nil {
			payload.OrgIDs = make([]string, 0, len(orgScans))
			for _, orgScan := range orgScans {
				payload.OrgIDs = append(payload.OrgIDs, orgScan.OrgID.String())
			}
		}
	}
}

func channelMatches(channel models.NotificationChannel, payload Payload) bool {
	if len(channel.OrgIDs) > 0 && !hasAnyOrgMatch(channel.OrgIDs, payload.OrgIDs) {
		return false
	}
	if len(channel.ImagePatterns) > 0 && !matchesAnyImagePattern(channel.ImagePatterns, payload.ImageName, payload.ImageTag) {
		return false
	}
	if strings.TrimSpace(channel.MinSeverity) != "" {
		channelSeverity := normalizeSeverity(channel.MinSeverity)
		payloadSeverity := highestSeverity(payload)
		if severityRank(payloadSeverity) < severityRank(channelSeverity) {
			return false
		}
	}
	return true
}

func hasAnyOrgMatch(channelOrgIDs []string, payloadOrgIDs []string) bool {
	if len(payloadOrgIDs) == 0 {
		return false
	}
	payloadSet := make(map[string]struct{}, len(payloadOrgIDs))
	for _, orgID := range payloadOrgIDs {
		payloadSet[strings.TrimSpace(orgID)] = struct{}{}
	}
	for _, orgID := range channelOrgIDs {
		if _, ok := payloadSet[strings.TrimSpace(orgID)]; ok {
			return true
		}
	}
	return false
}

func matchesAnyImagePattern(patterns []string, imageName string, imageTag string) bool {
	imageRef := strings.TrimSuffix(strings.TrimSpace(imageName)+":"+strings.TrimSpace(imageTag), ":")
	for _, pattern := range patterns {
		if wildcardMatch(pattern, imageName) || wildcardMatch(pattern, imageRef) {
			return true
		}
	}
	return false
}

func wildcardMatch(pattern string, target string) bool {
	if strings.TrimSpace(pattern) == "" {
		return false
	}
	var sb strings.Builder
	sb.WriteString("(?i)^")
	for _, ch := range pattern {
		switch ch {
		case '*':
			sb.WriteString(".*")
		case '?':
			sb.WriteString(".")
		case '.', '+', '(', ')', '[', ']', '{', '}', '^', '$', '|', '\\':
			sb.WriteString(`\\`)
			sb.WriteRune(ch)
		default:
			sb.WriteRune(ch)
		}
	}
	sb.WriteString("$")
	re, err := regexp.Compile(sb.String())
	if err != nil {
		return strings.EqualFold(pattern, target)
	}
	return re.MatchString(target)
}

func highestSeverity(payload Payload) string {
	switch {
	case payload.CriticalCount > 0:
		return models.SeverityCritical
	case payload.HighCount > 0:
		return models.SeverityHigh
	case payload.MediumCount > 0:
		return models.SeverityMedium
	case payload.LowCount > 0:
		return models.SeverityLow
	case payload.UnknownCount > 0:
		return models.SeverityUnknown
	default:
		return ""
	}
}

func normalizeSeverity(severity string) string {
	return strings.ToUpper(strings.TrimSpace(severity))
}

func severityRank(severity string) int {
	switch normalizeSeverity(severity) {
	case models.SeverityCritical:
		return 4
	case models.SeverityHigh:
		return 3
	case models.SeverityMedium:
		return 2
	case models.SeverityLow:
		return 1
	case models.SeverityUnknown:
		return 0
	default:
		return -1
	}
}

func recordDelivery(db *bun.DB, channelID uuid.UUID, event, triggeredBy, status, errorMessage, details string) {
	if db == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	entry := &models.NotificationDelivery{
		ChannelID:   channelID,
		Event:       event,
		TriggeredBy: triggeredBy,
		Status:      status,
		Error:       errorMessage,
		Details:     details,
	}
	if _, err := db.NewInsert().Model(entry).Exec(ctx); err != nil {
		log.Warnf("notifications.recordDelivery: failed to persist delivery log: %v", err)
	}
}

type discordEmbed struct {
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Color       int            `json:"color"`
	Fields      []discordField `json:"fields,omitempty"`
	Footer      discordFooter  `json:"footer"`
	Timestamp   string         `json:"timestamp"`
}

type discordField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline"`
}

type discordFooter struct {
	Text string `json:"text"`
}

type discordMessage struct {
	Username string         `json:"username"`
	Embeds   []discordEmbed `json:"embeds"`
}

func colorForEvent(event string) int {
	switch event {
	case models.NotificationEventScanComplete:
		return 0x10b981
	case models.NotificationEventScanFailed:
		return 0xef4444
	case models.NotificationEventComplianceFailed:
		return 0xf97316
	default:
		return 0x6366f1
	}
}

func sendDiscord(cfg models.NotificationConfig, p Payload) error {
	if cfg.WebhookURL == "" {
		return fmt.Errorf("discord webhook URL is not configured")
	}
	var fields []discordField
	if p.ImageName != "" {
		fields = append(fields, discordField{
			Name:   "Image",
			Value:  fmt.Sprintf("`%s:%s`", p.ImageName, p.ImageTag),
			Inline: true,
		})
	}
	if p.ScanID != "" {
		fields = append(fields, discordField{Name: "Scan ID", Value: p.ScanID, Inline: true})
	}
	embed := discordEmbed{
		Title:       eventTitle(p.Event),
		Description: p.Details,
		Color:       colorForEvent(p.Event),
		Fields:      fields,
		Footer:      discordFooter{Text: "JustScan"},
		Timestamp:   p.Timestamp.UTC().Format(time.RFC3339),
	}
	msg := discordMessage{Username: "JustScan", Embeds: []discordEmbed{embed}}
	return postJSON(cfg.WebhookURL, nil, msg)
}

func sendWebhook(cfg models.NotificationConfig, p Payload) error {
	if cfg.WebhookURL == "" {
		return fmt.Errorf("webhook URL is not configured")
	}
	headers := map[string]string{"Content-Type": "application/json"}
	for k, v := range cfg.Headers {
		headers[k] = v
	}
	return postJSON(cfg.WebhookURL, headers, p)
}

func sendSlack(cfg models.NotificationConfig, p Payload) error {
	if cfg.WebhookURL == "" {
		return fmt.Errorf("slack webhook URL is not configured")
	}
	body := map[string]any{
		"text": buildPlainMessage(p),
	}
	return postJSON(cfg.WebhookURL, nil, body)
}

func sendTeams(cfg models.NotificationConfig, p Payload) error {
	if cfg.WebhookURL == "" {
		return fmt.Errorf("teams webhook URL is not configured")
	}
	body := map[string]any{
		"@type":      "MessageCard",
		"@context":   "https://schema.org/extensions",
		"summary":    eventTitle(p.Event),
		"themeColor": fmt.Sprintf("%06x", colorForEvent(p.Event)),
		"title":      eventTitle(p.Event),
		"text":       strings.ReplaceAll(buildPlainMessage(p), "\n", "<br/>"),
	}
	return postJSON(cfg.WebhookURL, nil, body)
}

func sendTelegram(cfg models.NotificationConfig, p Payload) error {
	if cfg.TelegramBotToken == "" {
		return fmt.Errorf("telegram bot token is not configured")
	}
	if cfg.TelegramChatID == "" {
		return fmt.Errorf("telegram chat id is not configured")
	}
	body := map[string]any{
		"chat_id": cfg.TelegramChatID,
		"text":    buildPlainMessage(p),
	}
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", cfg.TelegramBotToken)
	return postJSON(url, nil, body)
}

func sendEmail(cfg models.NotificationConfig, p Payload) error {
	if cfg.SMTPHost == "" {
		return fmt.Errorf("SMTP host is not configured")
	}
	if len(cfg.ToAddresses) == 0 {
		return fmt.Errorf("no recipient email addresses configured")
	}
	subject := fmt.Sprintf("[JustScan] %s", eventTitle(p.Event))
	body := buildEmailBody(p)
	msg := []byte("From: " + cfg.SMTPFrom + "\r\n" +
		"To: " + strings.Join(cfg.ToAddresses, ", ") + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n" +
		"\r\n" + body)

	addr := fmt.Sprintf("%s:%d", cfg.SMTPHost, cfg.SMTPPort)
	var smtpAuth smtp.Auth
	if cfg.SMTPUsername != "" {
		smtpAuth = smtp.PlainAuth("", cfg.SMTPUsername, cfg.SMTPPassword, cfg.SMTPHost)
	}

	if cfg.SMTPTLS {
		tlsCfg := &tls.Config{ServerName: cfg.SMTPHost} //nolint:gosec
		conn, err := tls.Dial("tcp", addr, tlsCfg)
		if err != nil {
			return fmt.Errorf("smtp TLS dial: %w", err)
		}
		client, err := smtp.NewClient(conn, cfg.SMTPHost)
		if err != nil {
			return fmt.Errorf("smtp client: %w", err)
		}
		defer client.Close()
		if smtpAuth != nil {
			if err := client.Auth(smtpAuth); err != nil {
				return fmt.Errorf("smtp auth: %w", err)
			}
		}
		if err := client.Mail(cfg.SMTPFrom); err != nil {
			return err
		}
		for _, to := range cfg.ToAddresses {
			if err := client.Rcpt(to); err != nil {
				return err
			}
		}
		w, err := client.Data()
		if err != nil {
			return err
		}
		if _, err = w.Write(msg); err != nil {
			return err
		}
		return w.Close()
	}
	return smtp.SendMail(addr, smtpAuth, cfg.SMTPFrom, cfg.ToAddresses, msg)
}

func buildEmailBody(p Payload) string {
	var sb strings.Builder
	sb.WriteString(buildPlainMessage(p))
	return sb.String()
}

func buildPlainMessage(p Payload) string {
	var sb strings.Builder
	sb.WriteString(eventTitle(p.Event) + "\n")
	sb.WriteString(strings.Repeat("-", 40) + "\n\n")
	if p.ImageName != "" {
		sb.WriteString(fmt.Sprintf("Image:   %s:%s\n", p.ImageName, p.ImageTag))
	}
	if p.ScanID != "" {
		sb.WriteString(fmt.Sprintf("Scan ID: %s\n", p.ScanID))
	}
	if len(p.OrgIDs) > 0 {
		sb.WriteString(fmt.Sprintf("Orgs:    %s\n", strings.Join(p.OrgIDs, ", ")))
	}
	if severity := highestSeverity(p); severity != "" {
		sb.WriteString(fmt.Sprintf("Severity: %s\n", severity))
	}
	if p.CriticalCount+p.HighCount+p.MediumCount+p.LowCount+p.UnknownCount > 0 {
		sb.WriteString(fmt.Sprintf("Counts:  C:%d H:%d M:%d L:%d U:%d\n", p.CriticalCount, p.HighCount, p.MediumCount, p.LowCount, p.UnknownCount))
	}
	if p.Details != "" {
		sb.WriteString(fmt.Sprintf("\n%s\n", p.Details))
	}
	if len(p.Extra) > 0 {
		for key, value := range p.Extra {
			sb.WriteString(fmt.Sprintf("%s: %s\n", key, value))
		}
	}
	sb.WriteString(fmt.Sprintf("\nTimestamp: %s\n", p.Timestamp.Format(time.RFC1123)))
	return sb.String()
}

func eventTitle(event string) string {
	switch event {
	case models.NotificationEventScanComplete:
		return "Scan Completed"
	case models.NotificationEventScanFailed:
		return "Scan Failed"
	case models.NotificationEventComplianceFailed:
		return "Compliance Policy Failed"
	default:
		return event
	}
}

func postJSON(url string, headers map[string]string, body interface{}) error {
	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("json marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("webhook returned HTTP %d", resp.StatusCode)
	}
	return nil
}
