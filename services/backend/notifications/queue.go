package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

const (
	defaultQueueBatchSize     = 25
	defaultNotificationLease  = 30 * time.Second
	defaultDigestPollInterval = 15 * time.Second
	defaultQueuePollInterval  = 2 * time.Second
	defaultMatchPollInterval  = 2 * time.Second
)

var (
	workerCancel context.CancelFunc
	workerWG     sync.WaitGroup
)

func Start(db *bun.DB) {
	if db == nil || workerCancel != nil {
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	workerCancel = cancel

	workerWG.Add(3)
	go runMatcher(ctx, db)
	go runDigestScheduler(ctx, db)
	go runQueueWorker(ctx, db, fmt.Sprintf("worker-%s", uuid.NewString()))
}

func Stop() {
	if workerCancel == nil {
		return
	}
	workerCancel()
	workerWG.Wait()
	workerCancel = nil
}

func Dispatch(db *bun.DB, event string, p Payload) {
	if err := PublishEvent(context.Background(), db, event, p); err != nil {
		log.Warnf("notifications.Dispatch: failed to publish event %s: %v", event, err)
	}
}

func PublishEvent(ctx context.Context, db *bun.DB, event string, payload Payload) error {
	if db == nil {
		return fmt.Errorf("db is required")
	}
	payload.Timestamp = time.Now().UTC()
	payload.Event = strings.TrimSpace(event)
	if payload.Event == "" {
		return fmt.Errorf("event is required")
	}

	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	enrichPayload(ctx, db, &payload)
	rawPayload, err := payloadToJSONObject(payload)
	if err != nil {
		return err
	}

	var scanID *uuid.UUID
	if parsedScanID, parseErr := uuid.Parse(strings.TrimSpace(payload.ScanID)); parseErr == nil {
		scanID = &parsedScanID
	}

	entry := &models.NotificationEvent{
		Event:      payload.Event,
		ScanID:     scanID,
		DedupeKey:  strings.TrimSpace(payload.DedupeKey),
		Payload:    rawPayload,
		OccurredAt: payload.Timestamp,
	}
	insert := db.NewInsert().Model(entry)
	if entry.DedupeKey != "" {
		insert = insert.On("CONFLICT (dedupe_key) WHERE dedupe_key <> '' DO NOTHING")
	}
	_, err = insert.Exec(ctx)
	if err != nil {
		return fmt.Errorf("insert notification event: %w", err)
	}
	return nil
}

func runMatcher(ctx context.Context, db *bun.DB) {
	defer workerWG.Done()

	ticker := time.NewTicker(defaultMatchPollInterval)
	defer ticker.Stop()

	for {
		if err := matchPendingEvents(ctx, db, defaultQueueBatchSize); err != nil && ctx.Err() == nil {
			log.Warnf("notifications matcher: %v", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runDigestScheduler(ctx context.Context, db *bun.DB) {
	defer workerWG.Done()

	ticker := time.NewTicker(defaultDigestPollInterval)
	defer ticker.Stop()

	for {
		if err := queueDueDigests(ctx, db, defaultQueueBatchSize); err != nil && ctx.Err() == nil {
			log.Warnf("notifications digest scheduler: %v", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runQueueWorker(ctx context.Context, db *bun.DB, workerID string) {
	defer workerWG.Done()

	ticker := time.NewTicker(defaultQueuePollInterval)
	defer ticker.Stop()

	for {
		if err := processQueueBatch(ctx, db, workerID, defaultQueueBatchSize); err != nil && ctx.Err() == nil {
			log.Warnf("notifications queue worker: %v", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func matchPendingEvents(ctx context.Context, db *bun.DB, limit int) error {
	var events []models.NotificationEvent
	if err := db.NewSelect().
		Model(&events).
		Where("matched_at IS NULL").
		OrderExpr("created_at ASC").
		Limit(limit).
		Scan(ctx); err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return err
	}
	if len(events) == 0 {
		return nil
	}

	var rules []models.NotificationRule
	if err := db.NewSelect().
		Model(&rules).
		Where("enabled = true").
		Scan(ctx); err != nil {
		return err
	}

	var channels []models.NotificationChannel
	if err := db.NewSelect().
		Model(&channels).
		Where("enabled = true").
		Scan(ctx); err != nil {
		return err
	}

	channelByID := make(map[string]models.NotificationChannel, len(channels))
	for _, channel := range channels {
		channelByID[channel.ID.String()] = channel
	}

	for _, event := range events {
		payload, err := payloadFromJSONObject(event.Payload)
		if err != nil {
			log.Warnf("notifications matcher: decode payload for event %s: %v", event.ID, err)
			now := time.Now().UTC()
			_, _ = db.NewUpdate().Model((*models.NotificationEvent)(nil)).
				Set("matched_at = ?", now).
				Where("id = ?", event.ID).
				Exec(ctx)
			continue
		}

		for _, rule := range rules {
			if !notificationScopeMatches(rule, payload) {
				continue
			}
			if !ruleMatches(rule, payload) {
				continue
			}
			for _, channelID := range rule.ChannelIDs {
				channel, ok := channelByID[strings.TrimSpace(channelID)]
				if !ok {
					continue
				}
				if channel.ScopeType != rule.ScopeType || channel.ScopeRef != rule.ScopeRef {
					continue
				}
				if err := queueMatch(ctx, db, event, payload, rule, channel); err != nil {
					log.Warnf("notifications matcher: queue match event=%s rule=%s channel=%s failed: %v", event.ID, rule.ID, channel.ID, err)
				}
			}
		}

		now := time.Now().UTC()
		if _, err := db.NewUpdate().Model((*models.NotificationEvent)(nil)).
			Set("matched_at = ?", now).
			Where("id = ?", event.ID).
			Exec(ctx); err != nil {
			log.Warnf("notifications matcher: mark event %s matched failed: %v", event.ID, err)
		}
	}

	return nil
}

func notificationScopeMatches(rule models.NotificationRule, payload Payload) bool {
	scopeRef := strings.TrimSpace(rule.ScopeRef)
	switch rule.ScopeType {
	case models.NotificationScopeUser:
		return containsString(payload.UserIDs, scopeRef)
	case models.NotificationScopeOrg:
		return containsString(payload.OrgIDs, scopeRef)
	default:
		return true
	}
}

func containsString(values []string, target string) bool {
	target = strings.TrimSpace(target)
	if target == "" {
		return false
	}
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), target) {
			return true
		}
	}
	return false
}

func queueMatch(ctx context.Context, db *bun.DB, event models.NotificationEvent, payload Payload, rule models.NotificationRule, channel models.NotificationChannel) error {
	if rule.DeliveryMode == models.NotificationDeliveryModeDigest && rule.DigestWindowMinutes > 0 {
		return appendDigestEvent(ctx, db, event, rule, channel)
	}

	jobPayload, err := payloadToJSONObject(payload)
	if err != nil {
		return err
	}

	job := &models.NotificationQueueJob{
		EventID:        &event.ID,
		RuleID:         rule.ID,
		ChannelID:      channel.ID,
		ScopeType:      rule.ScopeType,
		ScopeRef:       rule.ScopeRef,
		DeliveryMode:   models.NotificationDeliveryModeImmediate,
		Status:         models.NotificationQueueStatusPending,
		MaxAttempts:    5,
		NextAttemptAt:  time.Now().UTC(),
		IdempotencyKey: fmt.Sprintf("event:%s:rule:%s:channel:%s", event.ID, rule.ID, channel.ID),
		Payload:        jobPayload,
	}

	_, err = db.NewInsert().
		Model(job).
		On("CONFLICT (idempotency_key) DO NOTHING").
		Exec(ctx)
	return err
}

func appendDigestEvent(ctx context.Context, db *bun.DB, event models.NotificationEvent, rule models.NotificationRule, channel models.NotificationChannel) error {
	windowMinutes := rule.DigestWindowMinutes
	if windowMinutes <= 0 {
		windowMinutes = 15
	}

	occurredAt := event.OccurredAt.UTC()
	windowStart := occurredAt.Truncate(time.Duration(windowMinutes) * time.Minute)
	windowEnd := windowStart.Add(time.Duration(windowMinutes) * time.Minute)
	now := time.Now().UTC()

	digest := &models.NotificationDigest{}
	err := db.NewSelect().
		Model(digest).
		Where("rule_id = ?", rule.ID).
		Where("channel_id = ?", channel.ID).
		Where("window_start = ?", windowStart).
		Where("window_end = ?", windowEnd).
		Scan(ctx)
	if err != nil && err != sql.ErrNoRows {
		return err
	}

	eventIDs := make(models.StringList, 0, 1)
	if err == nil {
		eventIDs = digest.EventIDs
		for _, existingID := range eventIDs {
			if existingID == event.ID.String() {
				return nil
			}
		}
	}
	eventIDs = append(eventIDs, event.ID.String())

	if err == sql.ErrNoRows {
		digest = &models.NotificationDigest{
			RuleID:      rule.ID,
			ChannelID:   channel.ID,
			ScopeType:   rule.ScopeType,
			ScopeRef:    rule.ScopeRef,
			WindowStart: windowStart,
			WindowEnd:   windowEnd,
			Status:      models.NotificationDigestStatusOpen,
			EventIDs:    eventIDs,
			EventCount:  len(eventIDs),
			LastEventAt: &now,
		}
		_, err = db.NewInsert().Model(digest).Exec(ctx)
		return err
	}

	_, err = db.NewUpdate().
		Model((*models.NotificationDigest)(nil)).
		Set("event_ids = ?", eventIDs).
		Set("event_count = ?", len(eventIDs)).
		Set("last_event_at = ?", now).
		Set("updated_at = ?", now).
		Where("id = ?", digest.ID).
		Exec(ctx)
	return err
}

func queueDueDigests(ctx context.Context, db *bun.DB, limit int) error {
	var digests []models.NotificationDigest
	if err := db.NewSelect().
		Model(&digests).
		Where("status = ?", models.NotificationDigestStatusOpen).
		Where("window_end <= ?", time.Now().UTC()).
		OrderExpr("window_end ASC").
		Limit(limit).
		Scan(ctx); err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return err
	}

	for _, digest := range digests {
		idempotencyKey := fmt.Sprintf("digest:%s:rule:%s:channel:%s", digest.ID, digest.RuleID, digest.ChannelID)
		job := &models.NotificationQueueJob{
			RuleID:         digest.RuleID,
			ChannelID:      digest.ChannelID,
			DigestID:       &digest.ID,
			ScopeType:      digest.ScopeType,
			ScopeRef:       digest.ScopeRef,
			DeliveryMode:   models.NotificationDeliveryModeDigest,
			Status:         models.NotificationQueueStatusPending,
			MaxAttempts:    5,
			NextAttemptAt:  time.Now().UTC(),
			IdempotencyKey: idempotencyKey,
			Payload: models.JSONObject{
				"digest_id":    digest.ID.String(),
				"event_count":  digest.EventCount,
				"window_start": digest.WindowStart.Format(time.RFC3339),
				"window_end":   digest.WindowEnd.Format(time.RFC3339),
			},
		}

		if _, err := db.NewInsert().
			Model(job).
			On("CONFLICT (idempotency_key) DO NOTHING").
			Exec(ctx); err != nil {
			return err
		}

		_, err := db.NewUpdate().
			Model((*models.NotificationDigest)(nil)).
			Set("status = ?", models.NotificationDigestStatusQueued).
			Set("queue_job_id = (SELECT id FROM notification_queue_jobs WHERE idempotency_key = ?)", idempotencyKey).
			Set("updated_at = ?", time.Now().UTC()).
			Where("id = ?", digest.ID).
			Exec(ctx)
		if err != nil {
			return err
		}
	}

	return nil
}

func processQueueBatch(ctx context.Context, db *bun.DB, workerID string, limit int) error {
	now := time.Now().UTC()
	leaseUntil := now.Add(defaultNotificationLease)

	var jobs []models.NotificationQueueJob
	if err := db.NewSelect().
		Model(&jobs).
		Where("(status = ? OR status = ?)", models.NotificationQueueStatusPending, models.NotificationQueueStatusFailed).
		Where("next_attempt_at <= ?", now).
		Where("(leased_until IS NULL OR leased_until < ?)", now).
		OrderExpr("next_attempt_at ASC").
		Limit(limit).
		Scan(ctx); err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return err
	}

	for _, job := range jobs {
		result, err := db.NewUpdate().
			Model((*models.NotificationQueueJob)(nil)).
			Set("status = ?", models.NotificationQueueStatusLeased).
			Set("lease_owner = ?", workerID).
			Set("leased_until = ?", leaseUntil).
			Set("updated_at = ?", now).
			Where("id = ?", job.ID).
			Where("(leased_until IS NULL OR leased_until < ?)", now).
			Where("(status = ? OR status = ?)", models.NotificationQueueStatusPending, models.NotificationQueueStatusFailed).
			Exec(ctx)
		if err != nil {
			return err
		}
		rows, _ := result.RowsAffected()
		if rows == 0 {
			continue
		}

		if err := deliverQueueJob(ctx, db, job.ID); err != nil {
			log.Warnf("notifications deliver job %s: %v", job.ID, err)
		}
	}

	return nil
}

func deliverQueueJob(ctx context.Context, db *bun.DB, jobID uuid.UUID) error {
	job := &models.NotificationQueueJob{}
	if err := db.NewSelect().Model(job).Where("id = ?", jobID).Scan(ctx); err != nil {
		return err
	}

	channel := &models.NotificationChannel{}
	if err := db.NewSelect().Model(channel).Where("id = ?", job.ChannelID).Scan(ctx); err != nil {
		return err
	}

	rule := &models.NotificationRule{}
	if err := db.NewSelect().Model(rule).Where("id = ?", job.RuleID).Scan(ctx); err != nil {
		return err
	}

	payload, err := buildJobPayload(ctx, db, *job, *rule, *channel)
	if err != nil {
		return failQueueJob(ctx, db, *job, *rule, *channel, err)
	}

	now := time.Now().UTC()
	sendErr := sendToChannel(*channel, payload)
	if sendErr != nil {
		return failQueueJob(ctx, db, *job, *rule, *channel, sendErr)
	}

	if _, err := db.NewUpdate().
		Model((*models.NotificationQueueJob)(nil)).
		Set("status = ?", models.NotificationQueueStatusDelivered).
		Set("attempt_count = attempt_count + 1").
		Set("last_error = ''").
		Set("last_attempt_at = ?", now).
		Set("delivered_at = ?", now).
		Set("lease_owner = ''").
		Set("leased_until = NULL").
		Set("updated_at = ?", now).
		Where("id = ?", job.ID).
		Exec(ctx); err != nil {
		return err
	}

	if job.DigestID != nil {
		_, err := db.NewUpdate().
			Model((*models.NotificationDigest)(nil)).
			Set("status = ?", models.NotificationDigestStatusDelivered).
			Set("delivered_at = ?", now).
			Set("updated_at = ?", now).
			Where("id = ?", *job.DigestID).
			Exec(ctx)
		if err != nil {
			return err
		}
	}

	recordDeliveryWithContext(db, deliveryContext{
		ChannelID:   channel.ID,
		RuleID:      &rule.ID,
		EventID:     job.EventID,
		QueueJobID:  &job.ID,
		Event:       payload.Event,
		TriggeredBy: "queue",
		Status:      models.NotificationQueueStatusDelivered,
		Details:     payload.Details,
		ScopeType:   job.ScopeType,
		ScopeRef:    job.ScopeRef,
	})
	return nil
}

func failQueueJob(ctx context.Context, db *bun.DB, job models.NotificationQueueJob, rule models.NotificationRule, channel models.NotificationChannel, sendErr error) error {
	now := time.Now().UTC()
	nextStatus := models.NotificationQueueStatusFailed
	nextAttemptAt := now.Add(backoffForAttempt(job.AttemptCount + 1))
	if job.AttemptCount+1 >= job.MaxAttempts {
		nextStatus = models.NotificationQueueStatusDeadLetter
		nextAttemptAt = now
	}

	if _, err := db.NewUpdate().
		Model((*models.NotificationQueueJob)(nil)).
		Set("status = ?", nextStatus).
		Set("attempt_count = attempt_count + 1").
		Set("last_error = ?", sendErr.Error()).
		Set("last_attempt_at = ?", now).
		Set("next_attempt_at = ?", nextAttemptAt).
		Set("lease_owner = ''").
		Set("leased_until = NULL").
		Set("updated_at = ?", now).
		Where("id = ?", job.ID).
		Exec(ctx); err != nil {
		return err
	}

	recordDeliveryWithContext(db, deliveryContext{
		ChannelID:   channel.ID,
		RuleID:      &rule.ID,
		EventID:     job.EventID,
		QueueJobID:  &job.ID,
		Event:       payloadEventForLog(job.Payload, sendErr),
		TriggeredBy: "queue",
		Status:      nextStatus,
		Error:       sendErr.Error(),
		Details:     sendErr.Error(),
		ScopeType:   job.ScopeType,
		ScopeRef:    job.ScopeRef,
	})
	return sendErr
}

func payloadEventForLog(raw models.JSONObject, sendErr error) string {
	if event, ok := raw["event"].(string); ok && strings.TrimSpace(event) != "" {
		return event
	}
	if sendErr != nil {
		return "notification_delivery"
	}
	return "notification_delivery"
}

func buildJobPayload(ctx context.Context, db *bun.DB, job models.NotificationQueueJob, rule models.NotificationRule, channel models.NotificationChannel) (Payload, error) {
	if job.DeliveryMode == models.NotificationDeliveryModeDigest && job.DigestID != nil {
		return buildDigestPayload(ctx, db, *job.DigestID, rule)
	}
	return payloadFromJSONObject(job.Payload)
}

func buildDigestPayload(ctx context.Context, db *bun.DB, digestID uuid.UUID, rule models.NotificationRule) (Payload, error) {
	digest := &models.NotificationDigest{}
	if err := db.NewSelect().Model(digest).Where("id = ?", digestID).Scan(ctx); err != nil {
		return Payload{}, err
	}
	var events []models.NotificationEvent
	if len(digest.EventIDs) > 0 {
		ids := make([]uuid.UUID, 0, len(digest.EventIDs))
		for _, eventID := range digest.EventIDs {
			parsedID, err := uuid.Parse(strings.TrimSpace(eventID))
			if err == nil {
				ids = append(ids, parsedID)
			}
		}
		if len(ids) > 0 {
			if err := db.NewSelect().Model(&events).Where("id IN (?)", bun.In(ids)).Scan(ctx); err != nil && err != sql.ErrNoRows {
				return Payload{}, err
			}
		}
	}

	sort.Slice(events, func(i, j int) bool {
		return events[i].OccurredAt.Before(events[j].OccurredAt)
	})

	payload := Payload{
		Event:     notificationDigestEvent,
		Details:   fmt.Sprintf("%d notification events matched rule %q between %s and %s.", digest.EventCount, rule.Name, digest.WindowStart.Format(time.RFC1123), digest.WindowEnd.Format(time.RFC1123)),
		Timestamp: time.Now().UTC(),
		Extra: map[string]string{
			"digest_window_start": digest.WindowStart.Format(time.RFC3339),
			"digest_window_end":   digest.WindowEnd.Format(time.RFC3339),
			"event_count":         strconv.Itoa(digest.EventCount),
			"rule_name":           rule.Name,
		},
	}

	seenOrgs := make(map[string]struct{})
	seenOrgNames := make(map[string]struct{})
	seenPolicies := make(map[string]struct{})
	seenWatches := make(map[string]struct{})
	for _, event := range events {
		itemPayload, err := payloadFromJSONObject(event.Payload)
		if err != nil {
			continue
		}
		payload.DigestEvents = append(payload.DigestEvents, newDigestEventSummary(event, itemPayload))
		if payload.ImageName == "" {
			payload.ImageName = itemPayload.ImageName
			payload.ImageTag = itemPayload.ImageTag
			payload.ScanID = itemPayload.ScanID
		}
		payload.CriticalCount += itemPayload.CriticalCount
		payload.HighCount += itemPayload.HighCount
		payload.MediumCount += itemPayload.MediumCount
		payload.LowCount += itemPayload.LowCount
		payload.UnknownCount += itemPayload.UnknownCount
		payload.SuppressedCount += itemPayload.SuppressedCount
		payload.HighestCVSS = maxFloat(payload.HighestCVSS, itemPayload.HighestCVSS)
		if severityRank(itemPayload.HighestSeverity) > severityRank(payload.HighestSeverity) {
			payload.HighestSeverity = itemPayload.HighestSeverity
		}
		for _, orgID := range itemPayload.OrgIDs {
			if _, ok := seenOrgs[orgID]; ok {
				continue
			}
			seenOrgs[orgID] = struct{}{}
			payload.OrgIDs = append(payload.OrgIDs, orgID)
		}
		for _, orgName := range itemPayload.OrgNames {
			if _, ok := seenOrgNames[orgName]; ok {
				continue
			}
			seenOrgNames[orgName] = struct{}{}
			payload.OrgNames = append(payload.OrgNames, orgName)
		}
		for _, name := range itemPayload.PolicyNames {
			if _, ok := seenPolicies[name]; ok {
				continue
			}
			seenPolicies[name] = struct{}{}
			payload.PolicyNames = append(payload.PolicyNames, name)
		}
		for _, name := range itemPayload.XrayWatchNames {
			if _, ok := seenWatches[name]; ok {
				continue
			}
			seenWatches[name] = struct{}{}
			payload.XrayWatchNames = append(payload.XrayWatchNames, name)
		}
	}
	return payload, nil
}

func newDigestEventSummary(event models.NotificationEvent, payload Payload) DigestEventSummary {
	eventType := strings.TrimSpace(payload.Event)
	if eventType == "" || eventType == "notification_event" {
		eventType = strings.TrimSpace(event.Event)
	}
	occurredAt := event.OccurredAt
	if occurredAt.IsZero() {
		occurredAt = payload.Timestamp
	}
	highestSeverityValue := payload.HighestSeverity
	if highestSeverityValue == "" {
		highestSeverityValue = highestSeverity(payload)
	}
	return DigestEventSummary{
		Event:                      eventType,
		OccurredAt:                 occurredAt,
		ScanID:                     payload.ScanID,
		ImageRef:                   payloadImageRef(payload),
		OrgNames:                   append([]string(nil), payload.OrgNames...),
		Status:                     payload.Status,
		ScanProvider:               payload.ScanProvider,
		HighestSeverity:            highestSeverityValue,
		HighestCVSS:                payload.HighestCVSS,
		CriticalCount:              payload.CriticalCount,
		HighCount:                  payload.HighCount,
		MediumCount:                payload.MediumCount,
		LowCount:                   payload.LowCount,
		UnknownCount:               payload.UnknownCount,
		SuppressedCount:            payload.SuppressedCount,
		ComplianceStatus:           payload.ComplianceStatus,
		ComplianceFailed:           payload.ComplianceFailed,
		XrayBlocked:                payload.XrayBlocked,
		PolicyNames:                append([]string(nil), payload.PolicyNames...),
		XrayPolicyNames:            append([]string(nil), payload.XrayPolicyNames...),
		XrayWatchNames:             append([]string(nil), payload.XrayWatchNames...),
		ChangedCVEs:                append([]string(nil), payload.ChangedCVEs...),
		HistoricalComplianceStatus: payload.HistoricalComplianceStatus,
		CurrentComplianceStatus:    payload.CurrentComplianceStatus,
		IntelligenceImpact:         payload.IntelligenceImpact,
		RescanRequired:             payload.RescanRequired,
		Tags:                       append([]string(nil), payload.Tags...),
		ScanURL:                    payload.ScanURL,
		Details:                    payload.Details,
	}
}

func backoffForAttempt(attempt int) time.Duration {
	switch {
	case attempt <= 1:
		return 15 * time.Second
	case attempt == 2:
		return 1 * time.Minute
	case attempt == 3:
		return 5 * time.Minute
	default:
		return 15 * time.Minute
	}
}

func payloadToJSONObject(payload Payload) (models.JSONObject, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	var out models.JSONObject
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func payloadFromJSONObject(raw models.JSONObject) (Payload, error) {
	bytes, err := json.Marshal(raw)
	if err != nil {
		return Payload{}, err
	}
	var payload Payload
	if err := json.Unmarshal(bytes, &payload); err != nil {
		return Payload{}, err
	}
	if payload.Event == "" {
		payload.Event = "notification_event"
	}
	if payload.Timestamp.IsZero() {
		payload.Timestamp = time.Now().UTC()
	}
	return payload, nil
}

func maxFloat(left float64, right float64) float64 {
	if right > left {
		return right
	}
	return left
}
