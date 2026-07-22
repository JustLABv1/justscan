package app

import "testing"

func TestCompareReleaseVersions(t *testing.T) {
	tests := []struct {
		current    string
		latest     string
		comparison int
		valid      bool
	}{
		{current: "1.2.3", latest: "v1.2.4", comparison: -1, valid: true},
		{current: "v1.2.3", latest: "1.2.3", comparison: 0, valid: true},
		{current: "2.0.0", latest: "v1.9.9", comparison: 1, valid: true},
		{current: "dev", latest: "v1.2.3", valid: false},
	}

	for _, test := range tests {
		t.Run(test.current+"-"+test.latest, func(t *testing.T) {
			comparison, valid := compareReleaseVersions(test.current, test.latest)
			if comparison != test.comparison || valid != test.valid {
				t.Fatalf("compareReleaseVersions(%q, %q) = (%d, %v), want (%d, %v)", test.current, test.latest, comparison, valid, test.comparison, test.valid)
			}
		})
	}
}
