package orgs

import (
	"testing"
	"time"

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

func TestResolveOrgTokenLifetime(t *testing.T) {
	oneHour := int(time.Hour / time.Second)
	tooLong := int(maximumOrgTokenLifetime/time.Second) + 1
	noExpiry := 0

	tests := []struct {
		name    string
		input   *int
		want    time.Duration
		wantErr bool
	}{
		{name: "default when omitted", want: defaultOrgTokenLifetime},
		{name: "explicit duration", input: &oneHour, want: time.Hour},
		{name: "five year option", input: &noExpiry, want: maximumOrgTokenLifetime},
		{name: "rejects durations beyond the maximum", input: &tooLong, wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := resolveOrgTokenLifetime(test.input)
			if (err != nil) != test.wantErr {
				t.Fatalf("resolveOrgTokenLifetime() error = %v, wantErr %v", err, test.wantErr)
			}
			if !test.wantErr && got != test.want {
				t.Fatalf("resolveOrgTokenLifetime() = %v, want %v", got, test.want)
			}
		})
	}
}
