package config

import (
	"fmt"
	"os"
	"strings"
	"sync"

	log "github.com/sirupsen/logrus"
	"github.com/spf13/viper"
)

var (
	instance *ConfigurationManager
	once     sync.Once
	// Expose loaded config as a package-level variable
	Config *RestfulConf
)

// ConfigurationManager handles all configuration operations
type ConfigurationManager struct {
	config *RestfulConf
	mu     sync.RWMutex
	viper  *viper.Viper
}

type RestfulConf struct {
	LogLevel     string         `mapstructure:"log_level" validate:"required,oneof=debug info warn error"`
	Port         int            `mapstructure:"port" validate:"required"`
	Database     DatabaseConf   `mapstructure:"database" validate:"required"`
	JWT          JWTConf        `mapstructure:"jwt" validate:"required"`
	AllowOrigins []string       `mapstructure:"allow_origins"`
	Security     SecurityConf   `mapstructure:"security"`
	AI           AIConf         `mapstructure:"ai"`
	Scanner      ScannerConf    `mapstructure:"scanner"`
	Encryption   EncryptionConf `mapstructure:"encryption"`
	VulnKB       VulnKBConf     `mapstructure:"vuln_kb"`
	LocalAuth    LocalAuthConf  `mapstructure:"local_auth"`
	MCP          MCPConf        `mapstructure:"mcp"`
}

type SecurityConf struct {
	AllowInsecureDefaults bool `mapstructure:"allow_insecure_defaults"`
	// Callback allowlists are opt-in escapes for self-hosted deployments that
	// intentionally deliver pipeline callbacks to private networks.
	CallbackAllowedHosts []string `mapstructure:"callback_allowed_hosts"`
	CallbackAllowedCIDRs []string `mapstructure:"callback_allowed_cidrs"`
}

type AIConf struct {
	Enabled               bool   `mapstructure:"enabled"`
	AllowAnonymous        bool   `mapstructure:"allow_anonymous"`
	DefaultProviderKey    string `mapstructure:"default_provider_key"`
	DefaultTimeoutSeconds int    `mapstructure:"default_timeout_seconds"`
	MaxContextResults     int    `mapstructure:"max_context_results"`
}

type LocalAuthConf struct {
	Enabled bool `mapstructure:"enabled"`
}

type MCPConf struct {
	Enabled             bool   `mapstructure:"enabled"`
	HTTPEnabled         bool   `mapstructure:"http_enabled"`
	Endpoint            string `mapstructure:"endpoint"`
	MaxPageSize         int    `mapstructure:"max_page_size"`
	MaxRequestBodyBytes int64  `mapstructure:"max_request_body_bytes"`
}

type ScannerConf struct {
	EnableTrivy               bool   `mapstructure:"enable_trivy"`
	TrivyPath                 string `mapstructure:"trivy_path"`
	GrypePath                 string `mapstructure:"grype_path"`
	EnableGrype               bool   `mapstructure:"enable_grype"`
	Timeout                   int    `mapstructure:"timeout"`
	CommandTimeoutSeconds     int    `mapstructure:"command_timeout_seconds"`
	ProgressHeartbeatSeconds  int    `mapstructure:"progress_heartbeat_seconds"`
	StaleTimeoutSeconds       int    `mapstructure:"stale_timeout_seconds"`
	Concurrency               int    `mapstructure:"concurrency"`
	DBMaxAgeHours             int    `mapstructure:"db_max_age_hours"`
	ScanCacheCleanupHours     int    `mapstructure:"scan_cache_cleanup_hours"`
	EnableOSVJavaAugmentation bool   `mapstructure:"enable_osv_java_augmentation"`
}

type EncryptionConf struct {
	Key string `mapstructure:"key"`
}

type VulnKBConf struct {
	NVDApiKey                      string `mapstructure:"nvd_api_key"`
	CacheDays                      int    `mapstructure:"cache_days"`
	CVEHistoryEnabled              bool   `mapstructure:"cve_history_enabled"`
	CVEHistoryIntervalMinutes      int    `mapstructure:"cve_history_interval_minutes"`
	CVEHistoryInitialLookbackHours int    `mapstructure:"cve_history_initial_lookback_hours"`
}

type DatabaseConf struct {
	Driver   string `mapstructure:"driver" validate:"required,oneof=postgres"`
	Server   string `mapstructure:"server"`
	Port     int    `mapstructure:"port"`
	Name     string `mapstructure:"name"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
}

type JWTConf struct {
	Secret string `mapstructure:"secret" validate:"required"`
}

// GetInstance returns the singleton configuration manager instance
func GetInstance() *ConfigurationManager {
	once.Do(func() {
		instance = &ConfigurationManager{
			viper: viper.New(),
		}
	})
	return instance
}

// LoadConfig initializes the configuration from file and environment
func (cm *ConfigurationManager) LoadConfig(configFile string) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	// Set up Viper
	cm.viper.SetConfigFile(configFile)
	cm.viper.SetEnvPrefix("BACKEND")
	cm.viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	cm.viper.AutomaticEnv()

	// Bind specific environment variables
	envBindings := map[string]string{
		"log_level":                                  "BACKEND_LOG_LEVEL",
		"port":                                       "BACKEND_PORT",
		"allow_origins":                              "BACKEND_ALLOW_ORIGINS",
		"database.driver":                            "BACKEND_DATABASE_DRIVER",
		"database.server":                            "BACKEND_DATABASE_SERVER",
		"database.port":                              "BACKEND_DATABASE_PORT",
		"database.name":                              "BACKEND_DATABASE_NAME",
		"database.user":                              "BACKEND_DATABASE_USER",
		"database.password":                          "BACKEND_DATABASE_PASSWORD",
		"ai.enabled":                                 "BACKEND_AI_ENABLED",
		"ai.allow_anonymous":                         "BACKEND_AI_ALLOW_ANONYMOUS",
		"ai.default_provider_key":                    "BACKEND_AI_DEFAULT_PROVIDER_KEY",
		"ai.default_timeout_seconds":                 "BACKEND_AI_DEFAULT_TIMEOUT_SECONDS",
		"ai.max_context_results":                     "BACKEND_AI_MAX_CONTEXT_RESULTS",
		"scanner.enable_trivy":                       "BACKEND_SCANNER_ENABLE_TRIVY",
		"scanner.trivy_path":                         "BACKEND_SCANNER_TRIVY_PATH",
		"scanner.grype_path":                         "BACKEND_SCANNER_GRYPE_PATH",
		"scanner.enable_grype":                       "BACKEND_SCANNER_ENABLE_GRYPE",
		"scanner.timeout":                            "BACKEND_SCANNER_TIMEOUT",
		"scanner.command_timeout_seconds":            "BACKEND_SCANNER_COMMAND_TIMEOUT_SECONDS",
		"scanner.progress_heartbeat_seconds":         "BACKEND_SCANNER_PROGRESS_HEARTBEAT_SECONDS",
		"scanner.stale_timeout_seconds":              "BACKEND_SCANNER_STALE_TIMEOUT_SECONDS",
		"scanner.concurrency":                        "BACKEND_SCANNER_CONCURRENCY",
		"scanner.db_max_age_hours":                   "BACKEND_SCANNER_DB_MAX_AGE_HOURS",
		"scanner.scan_cache_cleanup_hours":           "BACKEND_SCANNER_SCAN_CACHE_CLEANUP_HOURS",
		"scanner.enable_osv_java_augmentation":       "BACKEND_SCANNER_ENABLE_OSV_JAVA_AUGMENTATION",
		"data_path":                                  "BACKEND_DATA_PATH",
		"encryption.key":                             "BACKEND_ENCRYPTION_KEY",
		"encryption.master_secret":                   "BACKEND_ENCRYPTION_MASTER_SECRET",
		"jwt.secret":                                 "BACKEND_JWT_SECRET",
		"security.allow_insecure_defaults":           "BACKEND_SECURITY_ALLOW_INSECURE_DEFAULTS",
		"security.callback_allowed_hosts":            "BACKEND_SECURITY_CALLBACK_ALLOWED_HOSTS",
		"security.callback_allowed_cidrs":            "BACKEND_SECURITY_CALLBACK_ALLOWED_CIDRS",
		"runner.shared_runner_secret":                "BACKEND_RUNNER_SHARED_RUNNER_SECRET",
		"local_auth.enabled":                         "BACKEND_LOCAL_AUTH_ENABLED",
		"mcp.enabled":                                "BACKEND_MCP_ENABLED",
		"mcp.http_enabled":                           "BACKEND_MCP_HTTP_ENABLED",
		"mcp.endpoint":                               "BACKEND_MCP_ENDPOINT",
		"mcp.max_page_size":                          "BACKEND_MCP_MAX_PAGE_SIZE",
		"mcp.max_request_body_bytes":                 "BACKEND_MCP_MAX_REQUEST_BODY_BYTES",
		"vuln_kb.nvd_api_key":                        "BACKEND_VULN_KB_NVD_API_KEY",
		"vuln_kb.cache_days":                         "BACKEND_VULN_KB_CACHE_DAYS",
		"vuln_kb.cve_history_enabled":                "BACKEND_VULN_KB_CVE_HISTORY_ENABLED",
		"vuln_kb.cve_history_interval_minutes":       "BACKEND_VULN_KB_CVE_HISTORY_INTERVAL_MINUTES",
		"vuln_kb.cve_history_initial_lookback_hours": "BACKEND_VULN_KB_CVE_HISTORY_INITIAL_LOOKBACK_HOURS",
	}

	for configKey, envVar := range envBindings {
		if err := cm.viper.BindEnv(configKey, envVar); err != nil {
			return fmt.Errorf("failed to bind env var %s: %w", envVar, err)
		}
	}

	// Read configuration file
	if err := cm.viper.ReadInConfig(); err != nil {
		return fmt.Errorf("failed to read config file: %w", err)
	}

	// Create new config instance
	var config RestfulConf

	// Set defaults
	cm.setDefaults(&config)

	// Unmarshal configuration
	if err := cm.viper.Unmarshal(&config); err != nil {
		return fmt.Errorf("failed to unmarshal config: %w", err)
	}
	if raw, ok := os.LookupEnv("BACKEND_SECURITY_CALLBACK_ALLOWED_HOSTS"); ok {
		config.Security.CallbackAllowedHosts = splitConfigList(raw)
	}
	if raw, ok := os.LookupEnv("BACKEND_ALLOW_ORIGINS"); ok {
		config.AllowOrigins = splitConfigList(raw)
	}
	if raw, ok := os.LookupEnv("BACKEND_SECURITY_CALLBACK_ALLOWED_CIDRS"); ok {
		config.Security.CallbackAllowedCIDRs = splitConfigList(raw)
	}
	if err := cm.validate(&config); err != nil {
		return err
	}

	// Store the config
	cm.config = &config

	// Assign to package-level variable for global access
	Config = &config

	log.WithFields(log.Fields{
		"file":    configFile,
		"content": cm.viper.AllSettings(),
	}).Debug("Configuration loaded successfully")

	return nil
}

func splitConfigList(raw string) []string {
	values := strings.Split(raw, ",")
	result := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func (cm *ConfigurationManager) setDefaults(config *RestfulConf) {
	if config.LogLevel == "" {
		config.LogLevel = "info"
	}
	config.Security.AllowInsecureDefaults = false
	if config.Port == 0 {
		config.Port = 8080
	}
	if config.Database.Driver == "" {
		config.Database.Driver = "postgres"
	}
	if config.Database.Server == "" {
		config.Database.Server = "localhost"
	}
	if config.Database.Port == 0 {
		config.Database.Port = 5432
	}
	if config.Database.Name == "" {
		config.Database.Name = "postgres"
	}
	if config.Database.User == "" {
		config.Database.User = "postgres"
	}
	if config.Database.Password == "" {
		config.Database.Password = "postgres"
	}
	if config.AI.DefaultTimeoutSeconds == 0 {
		config.AI.DefaultTimeoutSeconds = 30
	}
	if config.AI.MaxContextResults == 0 {
		config.AI.MaxContextResults = 8
	}
	config.Scanner.EnableTrivy = true
	if config.Scanner.Timeout == 0 {
		config.Scanner.Timeout = 600
	}
	if config.Scanner.Concurrency == 0 {
		config.Scanner.Concurrency = 2
	}
	if config.Scanner.DBMaxAgeHours == 0 {
		config.Scanner.DBMaxAgeHours = 24
	}
	if !cm.viper.IsSet("scanner.scan_cache_cleanup_hours") {
		config.Scanner.ScanCacheCleanupHours = 24
	}
	config.Scanner.EnableOSVJavaAugmentation = true
	if !cm.viper.IsSet("vuln_kb.cve_history_enabled") {
		config.VulnKB.CVEHistoryEnabled = true
	}
	if config.VulnKB.CVEHistoryIntervalMinutes == 0 {
		config.VulnKB.CVEHistoryIntervalMinutes = 120
	}
	if config.VulnKB.CVEHistoryInitialLookbackHours == 0 {
		config.VulnKB.CVEHistoryInitialLookbackHours = 24
	}
	// Local auth is enabled by default
	if !cm.viper.IsSet("local_auth.enabled") {
		config.LocalAuth.Enabled = true
	}
	if config.MCP.MaxPageSize == 0 {
		config.MCP.MaxPageSize = 50
	}
	if config.MCP.Endpoint == "" {
		config.MCP.Endpoint = "/mcp"
	}
	if config.MCP.MaxRequestBodyBytes == 0 {
		config.MCP.MaxRequestBodyBytes = 4 << 20
	}
}

func (cm *ConfigurationManager) validate(config *RestfulConf) error {
	if !config.Scanner.EnableTrivy && config.Scanner.EnableGrype {
		return fmt.Errorf("invalid scanner configuration: enable_grype requires enable_trivy=true")
	}
	if config.MCP.MaxPageSize != 0 && (config.MCP.MaxPageSize < 1 || config.MCP.MaxPageSize > 100) {
		return fmt.Errorf("invalid mcp configuration: mcp.max_page_size must be between 1 and 100")
	}
	if config.MCP.Endpoint != "" && (!strings.HasPrefix(config.MCP.Endpoint, "/") || strings.Contains(config.MCP.Endpoint, "..")) {
		return fmt.Errorf("invalid mcp configuration: mcp.endpoint must be an absolute path without '..'")
	}
	if config.MCP.MaxRequestBodyBytes != 0 && (config.MCP.MaxRequestBodyBytes < 1024 || config.MCP.MaxRequestBodyBytes > 16<<20) {
		return fmt.Errorf("invalid mcp configuration: mcp.max_request_body_bytes must be between 1024 and 16777216")
	}
	if config.Security.AllowInsecureDefaults {
		return nil
	}

	jwtSecret := strings.TrimSpace(config.JWT.Secret)
	if len(jwtSecret) < 32 {
		return fmt.Errorf("invalid jwt configuration: jwt.secret must be at least 32 characters (or set security.allow_insecure_defaults=true for development only)")
	}

	encryptionKey := strings.TrimSpace(config.Encryption.Key)
	if len(encryptionKey) < 32 {
		return fmt.Errorf("invalid encryption configuration: encryption.key must be at least 32 characters (or set security.allow_insecure_defaults=true for development only)")
	}

	return nil
}

// GetConfig returns a copy of the current configuration
func (cm *ConfigurationManager) GetConfig() RestfulConf {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return *cm.config
}

// Global accessor for config
func GetConfigInstance() *RestfulConf {
	cfg := GetInstance().config
	if cfg == nil {
		panic("config: configuration not loaded, call LoadConfig first")
	}
	return cfg
}
