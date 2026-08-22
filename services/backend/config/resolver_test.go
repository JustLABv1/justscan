package config

import (
	"testing"
	"time"
)

func TestSettingResolverCachesMissingKeys(t *testing.T) {
	resolver := &SettingResolver{
		cache: map[string]cachedSetting{
			"scanner.missing": {
				found:     false,
				expiresAt: time.Now().Add(time.Minute),
			},
		},
	}

	if got := resolver.GetString("scanner.missing", "fallback"); got != "fallback" {
		t.Fatalf("GetString() = %q, want fallback", got)
	}
}

func TestSettingResolverAliasSkipsCachedMissingKey(t *testing.T) {
	resolver := &SettingResolver{
		cache: map[string]cachedSetting{
			"scanner.command_timeout_seconds": {
				found:     false,
				expiresAt: time.Now().Add(time.Minute),
			},
			"scanner.timeout_seconds": {
				value:     "900",
				found:     true,
				expiresAt: time.Now().Add(time.Minute),
			},
		},
	}

	if got := resolver.GetIntAny([]string{"scanner.command_timeout_seconds", "scanner.timeout_seconds"}, 300); got != 900 {
		t.Fatalf("GetIntAny() = %d, want 900", got)
	}
}
