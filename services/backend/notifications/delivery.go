package notifications

import (
	"context"
	"time"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

type deliveryContext struct {
	ChannelID   uuid.UUID
	RuleID      *uuid.UUID
	EventID     *uuid.UUID
	QueueJobID  *uuid.UUID
	Event       string
	TriggeredBy string
	Status      string
	Error       string
	Details     string
	ScopeType   string
	ScopeRef    string
}

func recordDeliveryWithContext(db *bun.DB, delivery deliveryContext) {
	if db == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	entry := &models.NotificationDelivery{
		ChannelID:   delivery.ChannelID,
		RuleID:      delivery.RuleID,
		EventID:     delivery.EventID,
		QueueJobID:  delivery.QueueJobID,
		Event:       delivery.Event,
		TriggeredBy: delivery.TriggeredBy,
		Status:      delivery.Status,
		Error:       delivery.Error,
		Details:     delivery.Details,
		ScopeType:   delivery.ScopeType,
		ScopeRef:    delivery.ScopeRef,
	}
	if _, err := db.NewInsert().Model(entry).Exec(ctx); err != nil {
		log.Warnf("notifications.recordDeliveryWithContext: failed to persist delivery log: %v", err)
	}
}
