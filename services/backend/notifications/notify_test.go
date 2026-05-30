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
