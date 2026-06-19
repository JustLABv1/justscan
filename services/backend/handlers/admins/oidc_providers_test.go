package admins

import "testing"

func TestValidateOIDCRegex(t *testing.T) {
	tests := []struct {
		name      string
		matchType string
		pattern   string
		template  string
		wantError bool
	}{
		{name: "valid capture", matchType: "regex", pattern: `^m[^_]+_default-roles-(.+)$`, template: "{suffix}"},
		{name: "invalid expression", matchType: "regex", pattern: `(`, template: "{claim}", wantError: true},
		{name: "suffix without capture", matchType: "regex", pattern: `^m.*$`, template: "{suffix}", wantError: true},
		{name: "regex without suffix", matchType: "regex", pattern: `^m.*$`, template: "{claim}"},
		{name: "non regex", matchType: "prefix", pattern: "team:", template: "{suffix}"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateOIDCRegex(test.matchType, test.pattern, test.template)
			if (err != nil) != test.wantError {
				t.Fatalf("validateOIDCRegex() error = %v, wantError %v", err, test.wantError)
			}
		})
	}
}
