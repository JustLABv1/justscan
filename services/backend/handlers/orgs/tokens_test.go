package orgs

import (
	"testing"

	"justscan-backend/pkg/models"
)

func TestNormalizeOrgTokenScope(t *testing.T) {
	tests := []struct {
		name  string
		input string
		scope string
		valid bool
	}{
		{"omitted remains backward compatible", "", models.OrgTokenScopeAdmin, true},
		{"admin scope", models.OrgTokenScopeAdmin, models.OrgTokenScopeAdmin, true},
		{"pipeline scope", models.OrgTokenScopePipelineScan, models.OrgTokenScopePipelineScan, true},
		{"invalid scope", "write_everything", "", false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			scope, valid := normalizeOrgTokenScope(test.input)
			if scope != test.scope || valid != test.valid {
				t.Fatalf("normalizeOrgTokenScope(%q) = (%q, %v), want (%q, %v)", test.input, scope, valid, test.scope, test.valid)
			}
		})
	}
}
