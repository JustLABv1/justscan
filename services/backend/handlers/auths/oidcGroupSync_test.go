package auths

import (
	"testing"

	"justscan-backend/pkg/models"
)

func TestMappingMatchesRegexUsesFirstCaptureAsSuffix(t *testing.T) {
	mapping := models.OIDCGroupOrgMapping{
		MatchType:  "regex",
		MatchValue: `^m[^_]+_default-roles-(.+)$`,
	}

	matched, suffix := mappingMatches(mapping, "m017-1_default-roles-m017-1")
	if !matched {
		t.Fatal("mappingMatches() did not match the role claim")
	}
	if suffix != "m017-1" {
		t.Fatalf("mappingMatches() suffix = %q, want %q", suffix, "m017-1")
	}
	if matched, _ := mappingMatches(mapping, "other-role"); matched {
		t.Fatal("mappingMatches() matched an unrelated role")
	}
}

func TestRenderOIDCNameTemplateAllowsRegexSuffix(t *testing.T) {
	name, err := renderOIDCNameTemplate("mapping-id", "regex", "{suffix}", "claim", "m017-1", "keycloak")
	if err != nil {
		t.Fatalf("renderOIDCNameTemplate() error = %v", err)
	}
	if name != "m017-1" {
		t.Fatalf("renderOIDCNameTemplate() = %q, want %q", name, "m017-1")
	}
}
