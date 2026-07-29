package helm

import "testing"

func TestHelmCredentialMatchesChart(t *testing.T) {
	tests := []struct {
		name, credentialURL, chartURL string
		want                          bool
	}{
		{"matching OCI repository", "oci://registry.example.com/team", "oci://registry.example.com/team/chart", true},
		{"matching HTTP repository", "https://charts.example.com/private", "https://charts.example.com/private", true},
		{"rejects sibling path", "oci://registry.example.com/team", "oci://registry.example.com/team-other/chart", false},
		{"rejects different host", "oci://registry.example.com/team", "oci://other.example.com/team/chart", false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := helmCredentialMatchesChart(test.credentialURL, test.chartURL); got != test.want {
				t.Fatalf("helmCredentialMatchesChart() = %v, want %v", got, test.want)
			}
		})
	}
}
