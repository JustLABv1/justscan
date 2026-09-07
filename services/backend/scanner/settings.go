package scanner

import "justscan-backend/config"

// ScannerSettings is the effective scanner runtime configuration. Values are
// read from the persisted admin settings when a resolver is available and
// otherwise fall back to the process configuration. Command timeout, database
// age, engine toggles, and OSV enrichment are intentionally resolved at use
// time so an admin update takes effect without silently requiring a restart.
type ScannerSettings struct {
	XrayConcurrency            int
	XrayMaxActive              int
	XrayWarmupTimeoutSeconds   int
	XrayProviderTimeoutSeconds int
	XrayTimeoutSeconds         int

	EnableTrivy               bool
	EnableGrype               bool
	Concurrency               int
	CommandTimeoutSeconds     int
	ProgressHeartbeatSeconds  int
	StaleTimeoutSeconds       int
	DBMaxAgeHours             int
	ScanCacheCleanupHours     int
	EnableOSVJavaAugmentation bool
}

func effectiveScannerSettings() ScannerSettings {
	settings := ScannerSettings{
		XrayConcurrency:            2,
		XrayMaxActive:              32,
		XrayWarmupTimeoutSeconds:   600,
		XrayProviderTimeoutSeconds: 900,
		XrayTimeoutSeconds:         3600,

		EnableTrivy:               true,
		EnableGrype:               false,
		Concurrency:               2,
		CommandTimeoutSeconds:     int(defaultScanCommandTimeout.Seconds()),
		ProgressHeartbeatSeconds:  int(defaultScanProgressHeartbeat.Seconds()),
		StaleTimeoutSeconds:       int(defaultScanStaleTimeout.Seconds()),
		DBMaxAgeHours:             24,
		ScanCacheCleanupHours:     24,
		EnableOSVJavaAugmentation: true,
	}
	if config.Config != nil {
		cfg := config.Config.Scanner
		if cfg.XrayConcurrency > 0 {
			settings.XrayConcurrency = cfg.XrayConcurrency
		}
		if cfg.XrayMaxActive > 0 {
			settings.XrayMaxActive = cfg.XrayMaxActive
		}
		if cfg.XrayWarmupTimeoutSeconds > 0 {
			settings.XrayWarmupTimeoutSeconds = cfg.XrayWarmupTimeoutSeconds
		}
		if cfg.XrayProviderTimeoutSeconds > 0 {
			settings.XrayProviderTimeoutSeconds = cfg.XrayProviderTimeoutSeconds
		}
		if cfg.XrayTimeoutSeconds > 0 {
			settings.XrayTimeoutSeconds = cfg.XrayTimeoutSeconds
		}

		settings.EnableTrivy = cfg.EnableTrivy
		settings.EnableGrype = cfg.EnableGrype
		settings.Concurrency = cfg.Concurrency
		settings.CommandTimeoutSeconds = cfg.CommandTimeoutSeconds
		if settings.CommandTimeoutSeconds <= 0 {
			// timeout was the original config key. Keep it as a config-file
			// fallback while the canonical runtime key is command_timeout_seconds.
			settings.CommandTimeoutSeconds = cfg.Timeout
		}
		settings.ProgressHeartbeatSeconds = cfg.ProgressHeartbeatSeconds
		settings.StaleTimeoutSeconds = cfg.StaleTimeoutSeconds
		settings.DBMaxAgeHours = cfg.DBMaxAgeHours
		settings.ScanCacheCleanupHours = cfg.ScanCacheCleanupHours
		settings.EnableOSVJavaAugmentation = cfg.EnableOSVJavaAugmentation
	}
	if settings.Concurrency <= 0 {
		settings.Concurrency = 2
	}
	if settings.CommandTimeoutSeconds <= 0 {
		settings.CommandTimeoutSeconds = int(defaultScanCommandTimeout.Seconds())
	}
	if settings.ProgressHeartbeatSeconds <= 0 {
		settings.ProgressHeartbeatSeconds = int(defaultScanProgressHeartbeat.Seconds())
	}
	if settings.StaleTimeoutSeconds <= 0 {
		settings.StaleTimeoutSeconds = int(defaultScanStaleTimeout.Seconds())
	}
	if settings.DBMaxAgeHours <= 0 {
		settings.DBMaxAgeHours = 24
	}
	if settings.ScanCacheCleanupHours < 0 {
		settings.ScanCacheCleanupHours = 0
	}

	if resolver := config.GetResolver(); resolver != nil {
		settings.XrayConcurrency = resolver.GetInt("scanner.xray_concurrency", settings.XrayConcurrency)
		settings.XrayMaxActive = resolver.GetInt("scanner.xray_max_active", settings.XrayMaxActive)
		settings.XrayWarmupTimeoutSeconds = resolver.GetInt("scanner.xray_warmup_timeout_seconds", settings.XrayWarmupTimeoutSeconds)
		settings.XrayProviderTimeoutSeconds = resolver.GetInt("scanner.xray_provider_timeout_seconds", settings.XrayProviderTimeoutSeconds)
		settings.XrayTimeoutSeconds = resolver.GetInt("scanner.xray_timeout_seconds", settings.XrayTimeoutSeconds)

		settings.EnableTrivy = resolver.GetBool("scanner.enable_trivy", settings.EnableTrivy)
		settings.EnableGrype = resolver.GetBool("scanner.enable_grype", settings.EnableGrype)
		settings.Concurrency = resolver.GetInt("scanner.concurrency", settings.Concurrency)
		settings.CommandTimeoutSeconds = resolver.GetIntAny(
			[]string{"scanner.command_timeout_seconds", "scanner.timeout_seconds"},
			settings.CommandTimeoutSeconds,
		)
		settings.ProgressHeartbeatSeconds = resolver.GetInt("scanner.progress_heartbeat_seconds", settings.ProgressHeartbeatSeconds)
		settings.StaleTimeoutSeconds = resolver.GetInt("scanner.stale_timeout_seconds", settings.StaleTimeoutSeconds)
		settings.DBMaxAgeHours = resolver.GetInt("scanner.db_max_age_hours", settings.DBMaxAgeHours)
		settings.ScanCacheCleanupHours = resolver.GetInt("scanner.scan_cache_cleanup_hours", settings.ScanCacheCleanupHours)
		settings.EnableOSVJavaAugmentation = resolver.GetBool("scanner.enable_osv_java_augmentation", settings.EnableOSVJavaAugmentation)
	}

	if settings.Concurrency <= 0 {
		settings.Concurrency = 2
	}
	if settings.CommandTimeoutSeconds <= 0 {
		settings.CommandTimeoutSeconds = int(defaultScanCommandTimeout.Seconds())
	}
	if settings.ProgressHeartbeatSeconds <= 0 {
		settings.ProgressHeartbeatSeconds = int(defaultScanProgressHeartbeat.Seconds())
	}
	if settings.StaleTimeoutSeconds <= 0 {
		settings.StaleTimeoutSeconds = int(defaultScanStaleTimeout.Seconds())
	}
	if settings.DBMaxAgeHours <= 0 {
		settings.DBMaxAgeHours = 24
	}
	if settings.ScanCacheCleanupHours < 0 {
		settings.ScanCacheCleanupHours = 0
	}
	if settings.XrayConcurrency <= 0 {
		settings.XrayConcurrency = 2
	}
	if settings.XrayMaxActive <= 0 {
		settings.XrayMaxActive = 32
	}
	if settings.XrayWarmupTimeoutSeconds <= 0 {
		settings.XrayWarmupTimeoutSeconds = 600
	}
	if settings.XrayProviderTimeoutSeconds <= 0 {
		settings.XrayProviderTimeoutSeconds = 900
	}
	if settings.XrayTimeoutSeconds <= 0 {
		settings.XrayTimeoutSeconds = 3600
	}
	return settings
}

// EffectiveScannerSettings exposes the same resolver-backed view for health
// and operational reporting without duplicating key/alias handling.
func EffectiveScannerSettings() ScannerSettings {
	return effectiveScannerSettings()
}
