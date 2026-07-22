package pipelines

import (
	"context"
	"testing"
)

func TestValidateCallbackURLRejectsUnsafeURLs(t *testing.T) {
	tests := []string{
		"http://example.com/callback",
		"https://user:password@example.com/callback",
		"https://example.com/callback#fragment",
		"https://127.0.0.1/callback",
		"https://192.168.1.10/callback",
	}

	for _, raw := range tests {
		t.Run(raw, func(t *testing.T) {
			if _, err := ValidateCallbackURL(context.Background(), raw); err == nil {
				t.Fatalf("ValidateCallbackURL(%q) unexpectedly succeeded", raw)
			}
		})
	}
}
