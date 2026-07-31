package statuspages

import (
	"strings"
	"testing"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
)

func TestBuildStatusPageModelsAcceptsRegexScope(t *testing.T) {
	page, targets, sources, updates, err := buildStatusPageModels(statusPagePayload{
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
	if len(sources) != 0 {
		t.Fatalf("expected no Git sources, got %d", len(sources))
	}
	if len(updates) != 0 {
		t.Fatalf("expected no updates, got %d", len(updates))
	}
	if len(page.ImagePatterns) != 1 || page.ImagePatterns[0] != `^ghcr\.io/acme/.+:prod-.*$` {
		t.Fatalf("unexpected image patterns: %#v", page.ImagePatterns)
	}
}

func TestBuildStatusPageModelsRejectsInvalidRegex(t *testing.T) {
	_, _, _, _, err := buildStatusPageModels(statusPagePayload{
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

func TestNormalizeSlugMatchesAvailabilityCheckInput(t *testing.T) {
	if got := normalizeSlug(" Production Containers "); got != "production-containers" {
		t.Fatalf("expected normalized slug, got %q", got)
	}
	if got := normalizeSlug("---"); got != "" {
		t.Fatalf("expected empty slug for non-alphanumeric input, got %q", got)
	}
}

func TestBuildStatusPageModelsAcceptsGitRepositorySourceWithoutFixedTargets(t *testing.T) {
	repositoryID := uuid.New()
	_, targets, sources, _, err := buildStatusPageModels(statusPagePayload{
		Name:       "GitOps production",
		Visibility: models.StatusPageVisibilityAuthenticated,
		GitRepositorySources: []statusPageGitRepositorySourcePayload{{
			RepositoryID: repositoryID.String(),
		}},
	}, uuid.New())
	if err != nil {
		t.Fatalf("buildStatusPageModels returned error: %v", err)
	}
	if len(targets) != 0 || len(sources) != 1 {
		t.Fatalf("expected one source and no targets, got %d sources and %d targets", len(sources), len(targets))
	}
	if sources[0].RepositoryID != repositoryID || sources[0].DisplayOrder != 1 {
		t.Fatalf("unexpected Git source: %#v", sources[0])
	}
}

func TestBuildStatusPageModelsNormalizesGitRepositorySourceImageNames(t *testing.T) {
	repositoryID := uuid.New()
	_, _, sources, _, err := buildStatusPageModels(statusPagePayload{
		Name:       "GitOps production",
		Visibility: models.StatusPageVisibilityAuthenticated,
		GitRepositorySources: []statusPageGitRepositorySourcePayload{{
			RepositoryID: repositoryID.String(),
			ImageNames:   []string{" ghcr.io/acme/api ", "ghcr.io/acme/web", "ghcr.io/acme/api", ""},
		}},
	}, uuid.New())
	if err != nil {
		t.Fatalf("buildStatusPageModels returned error: %v", err)
	}
	if len(sources) != 1 || len(sources[0].ImageNames) != 2 {
		t.Fatalf("expected two normalized image names, got %#v", sources)
	}
	if sources[0].ImageNames[0] != "ghcr.io/acme/api" || sources[0].ImageNames[1] != "ghcr.io/acme/web" {
		t.Fatalf("unexpected normalized image names: %#v", sources[0].ImageNames)
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

func TestMarkStatusPageItemUnscannedDoesNotImplyAnActiveScan(t *testing.T) {
	item := StatusPageItem{ScanStatus: models.ScanStatusPending, Status: models.ScanStatusPending}

	markStatusPageItemUnscanned(&item)

	if item.Status != statusPageItemStatusUnscanned {
		t.Fatalf("expected status %q, got %q", statusPageItemStatusUnscanned, item.Status)
	}
	if item.ScanStatus != "" {
		t.Fatalf("expected no scan status for unscanned item, got %q", item.ScanStatus)
	}
}

func TestDeriveStatusKeepsCompletedScanOperationallyHealthyDespiteFindings(t *testing.T) {
	status := deriveStatus(72, StatusPageItem{
		ScanStatus:     models.ScanStatusCompleted,
		CriticalCount:  2,
		HighCount:      5,
		FreshnessHours: 4,
	})

	if status != "healthy" {
		t.Fatalf("expected healthy operational status for completed scan with findings, got %q", status)
	}
}

func TestBuildStatusPageScanSummaryIncludesOrgComplianceStatus(t *testing.T) {
	scan := &models.Scan{
		ID:        uuid.New(),
		Status:    models.ScanStatusCompleted,
		ImageName: "ghcr.io/acme/api",
		ImageTag:  "prod",
	}

	summary := buildStatusPageScanSummary(scan, scan.ID, "fail")

	if summary.ComplianceStatus != "fail" {
		t.Fatalf("expected compliance status fail, got %q", summary.ComplianceStatus)
	}
	if summary.ScanStatus != models.ScanStatusCompleted {
		t.Fatalf("expected completed scan status to remain unchanged, got %q", summary.ScanStatus)
	}
}

func TestStatusPageScanScopeUsesCurrentOwnerOrganization(t *testing.T) {
	previousOrgID := uuid.New()
	destinationOrgID := uuid.New()
	page := &models.StatusPage{
		OwnerType:  models.OwnerTypeOrg,
		OwnerOrgID: &destinationOrgID,
	}

	where, args := statusPageScanScopeWhere(page, "scan")
	if !strings.Contains(where, "scan.owner_org_id") {
		t.Fatalf("expected organization-owned scan scope, got %q", where)
	}
	if len(args) != 2 || args[0] != destinationOrgID || args[1] != destinationOrgID {
		t.Fatalf("expected destination organization %s to scope both clauses, got %#v", destinationOrgID, args)
	}
	if args[0] == previousOrgID {
		t.Fatal("status page scan scope must not retain the former owner")
	}
}

func TestRebindStatusPageRelationsUsesExistingPageID(t *testing.T) {
	userID := uuid.New()
	existingPageID := uuid.New()

	_, targets, sources, updates, err := buildStatusPageModels(statusPagePayload{
		Name:           "Production",
		Visibility:     models.StatusPageVisibilityPublic,
		IncludeAllTags: false,
		Targets: []statusPageTargetPayload{{
			ImageName:    "ghcr.io/acme/api",
			ImageTag:     "prod",
			DisplayOrder: 1,
		}},
		Updates: []statusPageUpdatePayload{{
			Title: "Maintenance window",
			Body:  "Registry credentials are being rotated.",
			Level: "maintenance",
		}},
	}, userID)
	if err != nil {
		t.Fatalf("buildStatusPageModels returned error: %v", err)
	}
	if len(targets) != 1 {
		t.Fatalf("expected 1 target, got %d", len(targets))
	}
	if len(updates) != 1 {
		t.Fatalf("expected 1 update, got %d", len(updates))
	}
	if targets[0].PageID == existingPageID || updates[0].PageID == existingPageID {
		t.Fatal("expected buildStatusPageModels to use a fresh page ID before rebinding")
	}

	rebindStatusPageRelations(existingPageID, targets, sources, updates)

	if targets[0].PageID != existingPageID {
		t.Fatalf("expected target page_id %s, got %s", existingPageID, targets[0].PageID)
	}
	if updates[0].PageID != existingPageID {
		t.Fatalf("expected update page_id %s, got %s", existingPageID, updates[0].PageID)
	}
}
