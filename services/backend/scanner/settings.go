package scanner

import "justscan-backend/config"

// ScannerSettings is the effective scanner runtime configuration. Values are
// read from the persisted admin settings when a resolver is available and
// otherwise fall back to the process configuration. Command timeout, database
// age, engine toggles, and OSV enrichment are intentionally resolved at use
// time so an admin update takes effect without silently requiring a restart.
type ScannerSettings struct {
	EnableTrivy               bool
	EnableGrype               bool
	Concurrency               int
	CommandTimeoutSeconds     int
	ProgressHeartbeatSeconds  int
	StaleTimeoutSeconds       int
	DBMaxAgeHours             int
	EnableOSVJavaAugmentation bool
}

func effectiveScannerSettings() ScannerSettings {
	settings := ScannerSettings{
		EnableTrivy:               true,
		EnableGrype:               false,
		Concurrency:               2,
		CommandTimeoutSeconds:     int(defaultScanCommandTimeout.Seconds()),
		ProgressHeartbeatSeconds:  int(defaultScanProgressHeartbeat.Seconds()),
		StaleTimeoutSeconds:       int(defaultScanStaleTimeout.Seconds()),
		DBMaxAgeHours:             24,
		EnableOSVJavaAugmentation: true,
	}
	if config.Config != nil {
		cfg := config.Config.Scanner
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

	if resolver := config.GetResolver(); resolver != nil {
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
	return settings
}

// EffectiveScannerSettings exposes the same resolver-backed view for health
// and operational reporting without duplicating key/alias handling.
func EffectiveScannerSettings() ScannerSettings {
	return effectiveScannerSettings()
}
