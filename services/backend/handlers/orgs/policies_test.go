package orgs

import "testing"

func TestPolicyIncludeSuppressedOrDefault(t *testing.T) {
	tests := []struct {
		name  string
		input *bool
		want  bool
	}{
		{name: "nil defaults to true", input: nil, want: true},
		{name: "explicit true", input: boolPtr(true), want: true},
		{name: "explicit false", input: boolPtr(false), want: false},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			got := policyIncludeSuppressedOrDefault(testCase.input)
			if got != testCase.want {
				t.Fatalf("expected %v, got %v", testCase.want, got)
			}
		})
	}
}

func boolPtr(value bool) *bool {
	return &value
}
