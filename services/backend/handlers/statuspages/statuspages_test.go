package statuspages

import (
	"strings"
	"testing"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
)

func TestBuildStatusPageModelsAcceptsRegexScope(t *testing.T) {
	page, targets, updates, err := buildStatusPageModels(statusPagePayload{
		Name:           "Production",
		Visibility:     models.StatusPageVisibilityPublic,
		ImagePatterns:  []string{`^ghcr\.io/acme/.+:prod-.*$`},
		IncludeAllTags: false,
	}, uuid.New())
	if err != nil {
		t.Fatalf("buildStatusPageModels returned error: %v", err)
	}
	if len(targets) != 0 {
		t.Fatalf("expected no exact targets, got %d", len(targets))
	}
	if len(updates) != 0 {
		t.Fatalf("expected no updates, got %d", len(updates))
	}
	if len(page.ImagePatterns) != 1 || page.ImagePatterns[0] != `^ghcr\.io/acme/.+:prod-.*$` {
		t.Fatalf("unexpected image patterns: %#v", page.ImagePatterns)
	}
}

func TestBuildStatusPageModelsRejectsInvalidRegex(t *testing.T) {
	_, _, _, err := buildStatusPageModels(statusPagePayload{
		Name:          "Production",
		Visibility:    models.StatusPageVisibilityPrivate,
		ImagePatterns: []string{"("},
	}, uuid.New())
	if err == nil {
		t.Fatal("expected invalid regex error")
	}
	if !strings.Contains(err.Error(), "invalid image regex") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestMatchesStatusPagePatternsChecksReferenceNameAndTag(t *testing.T) {
	compiled, err := compileStatusPagePatterns(models.StringList{`^ghcr\.io/acme/api:prod-.*$`, `^stable$`})
	if err != nil {
		t.Fatalf("compileStatusPagePatterns returned error: %v", err)
	}

	if !matchesStatusPagePatterns(compiled, "ghcr.io/acme/api", "prod-2024") {
		t.Fatal("expected full image reference pattern to match")
	}
	if !matchesStatusPagePatterns(compiled, "ghcr.io/acme/web", "stable") {
		t.Fatal("expected image tag pattern to match")
	}
	if matchesStatusPagePatterns(compiled, "ghcr.io/acme/web", "dev") {
		t.Fatal("did not expect unrelated image to match")
	}
}

func TestDeriveStatusTreatsBlockedXrayPolicySeparately(t *testing.T) {
	status := deriveStatus(72, StatusPageItem{
		ScanStatus:     models.ScanStatusFailed,
		ExternalStatus: models.ScanExternalStatusBlockedByXrayPolicy,
	})

	if status != models.ScanExternalStatusBlockedByXrayPolicy {
		t.Fatalf("expected blocked xray policy status, got %q", status)
	}
}

func TestDeriveStatusKeepsRunningState(t *testing.T) {
	status := deriveStatus(72, StatusPageItem{ScanStatus: models.ScanStatusRunning})
	if status != models.ScanStatusRunning {
		t.Fatalf("expected running status, got %q", status)
	}
}
