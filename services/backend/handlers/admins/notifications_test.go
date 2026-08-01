package admins

import (
	"testing"

	"justscan-backend/pkg/models"
)

func TestAdminNotificationEventValidationIncludesIntelligenceImpact(t *testing.T) {
	if !isAllowedNotificationEvent(models.NotificationEventIntelligencePolicyImpact) {
		t.Fatal("intelligence policy impact should be an allowed notification event")
	}
	if isAllowedNotificationEvent("unknown_event") {
		t.Fatal("unknown notification events should remain rejected")
	}
}
