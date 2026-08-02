package notifications

import (
	"strings"
	"testing"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/models"
)

func TestBuildPlainMessageUsesOrgNamesAndScanURL(t *testing.T) {
	originalConfig := config.Config
	config.Config = &config.RestfulConf{
		AllowOrigins: []string{"https://scan.example.com/"},
	}
	t.Cleanup(func() {
		config.Config = originalConfig
	})

	payload := Payload{
		Event:         models.NotificationEventScanComplete,
		ScanID:        "scan-123",
		ImageName:     "ghcr.io/acme/api",
		ImageTag:      "1.2.3",
		OrgIDs:        []string{"11111111-1111-1111-1111-111111111111"},
		OrgNames:      []string{"Platform"},
		CriticalCount: 1,
		HighCount:     2,
		Details:       "Test notification",
		ScanURL:       buildScanURL("scan-123"),
		Timestamp:     time.Date(2026, 5, 30, 12, 0, 0, 0, time.UTC),
	}

	message := buildPlainMessage(payload)
	if !strings.Contains(message, "Orgs:    Platform") {
		t.Fatalf("expected org names in message, got %q", message)
	}
	if strings.Contains(message, "11111111-1111-1111-1111-111111111111") {
		t.Fatalf("expected message not to include org id when org names are available, got %q", message)
	}
	if !strings.Contains(message, "Open scan: https://scan.example.com/scans/scan-123") {
		t.Fatalf("expected scan link in message, got %q", message)
	}
}

func TestBuildScanURLUsesFirstAllowOrigin(t *testing.T) {
	originalConfig := config.Config
	config.Config = &config.RestfulConf{
		AllowOrigins: []string{"", "https://scan.example.com/app/"},
	}
	t.Cleanup(func() {
		config.Config = originalConfig
	})

	if got := buildScanURL("abc123"); got != "https://scan.example.com/app/scans/abc123" {
		t.Fatalf("unexpected scan url: %s", got)
	}
}

func TestDigestEventSummaryPreservesEventContext(t *testing.T) {
	occurredAt := time.Date(2026, 8, 2, 5, 0, 0, 0, time.UTC)
	summary := newDigestEventSummary(
		models.NotificationEvent{
			Event:      models.NotificationEventScanComplete,
			OccurredAt: occurredAt,
		},
		Payload{
			Event:           models.NotificationEventScanComplete,
			ScanID:          "scan-123",
			ImageName:       "ghcr.io/acme/frontend",
			ImageTag:        "beta",
			ScanProvider:    "trivy",
			HighestSeverity: models.SeverityCritical,
			CriticalCount:   2,
			Details:         "2 critical findings",
		},
	)

	if summary.Event != models.NotificationEventScanComplete {
		t.Fatalf("unexpected event type: %q", summary.Event)
	}
	if !summary.OccurredAt.Equal(occurredAt) {
		t.Fatalf("unexpected event timestamp: %s", summary.OccurredAt)
	}
	if summary.ImageRef != "ghcr.io/acme/frontend:beta" {
		t.Fatalf("unexpected image reference: %q", summary.ImageRef)
	}
	if summary.ScanID != "scan-123" || summary.CriticalCount != 2 {
		t.Fatalf("summary lost scan or finding context: %+v", summary)
	}
}

func TestDigestMessagesListEachMatchedEvent(t *testing.T) {
	payload := Payload{
		Event:   notificationDigestEvent,
		Details: `2 notification events matched rule "Beta Release".`,
		Extra: map[string]string{
			"event_count": "2",
		},
		DigestEvents: []DigestEventSummary{
			{
				Event:           models.NotificationEventScanComplete,
				OccurredAt:      time.Date(2026, 8, 2, 5, 0, 0, 0, time.UTC),
				ScanID:          "scan-complete",
				ImageRef:        "ghcr.io/acme/frontend:beta",
				HighestSeverity: models.SeverityCritical,
				CriticalCount:   2,
			},
			{
				Event:      models.NotificationEventScanFailed,
				OccurredAt: time.Date(2026, 8, 2, 5, 5, 0, 0, time.UTC),
				ScanID:     "scan-failed",
				ImageRef:   "ghcr.io/acme/backend:beta",
				Status:     models.ScanStatusFailed,
				Details:    "registry unavailable",
			},
		},
	}

	plain := buildPlainMessage(payload)
	for _, expected := range []string{
		"Scan Completed",
		"ghcr.io/acme/frontend:beta",
		"scan-complete",
		"Scan Failed",
		"ghcr.io/acme/backend:beta",
		"scan-failed",
		"registry unavailable",
	} {
		if !strings.Contains(plain, expected) {
			t.Fatalf("expected digest text to contain %q, got %q", expected, plain)
		}
	}

	embeds := buildDiscordDigestEmbeds(payload)
	if len(embeds) != 1 {
		t.Fatalf("expected one Discord embed for two events, got %d", len(embeds))
	}
	var discordText strings.Builder
	for _, field := range embeds[0].Fields {
		discordText.WriteString(field.Name)
		discordText.WriteString("\n")
		discordText.WriteString(field.Value)
		discordText.WriteString("\n")
	}
	for _, expected := range []string{
		"01 · Scan Completed",
		"ghcr.io/acme/frontend:beta",
		"scan-complete",
		"02 · Scan Failed",
		"ghcr.io/acme/backend:beta",
		"scan-failed",
	} {
		if !strings.Contains(discordText.String(), expected) {
			t.Fatalf("expected Discord digest to contain %q, got %q", expected, discordText.String())
		}
	}
}
