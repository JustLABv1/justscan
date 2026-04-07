package config

import (
	"fmt"
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
	Scanner      ScannerConf    `mapstructure:"scanner"`
	Encryption   EncryptionConf `mapstructure:"encryption"`
	VulnKB       VulnKBConf     `mapstructure:"vuln_kb"`
	OIDC         OIDCConf       `mapstructure:"oidc"`
	LocalAuth    LocalAuthConf  `mapstructure:"local_auth"`
}

type OIDCConf struct {
	Enabled      bool     `mapstructure:"enabled"`
	Debug        bool     `mapstructure:"debug"`
	IssuerURL    string   `mapstructure:"issuer_url"`
	ClientID     string   `mapstructure:"client_id"`
	ClientSecret string   `mapstructure:"client_secret"`
	RedirectURI  string   `mapstructure:"redirect_uri"`
	Scopes       []string `mapstructure:"scopes"`
	AdminGroups  []string `mapstructure:"admin_groups"`
	AdminRoles   []string `mapstructure:"admin_roles"`
	GroupsClaim  string   `mapstructure:"groups_claim"`
	RolesClaim   string   `mapstructure:"roles_claim"`
}

type LocalAuthConf struct {
	Enabled bool `mapstructure:"enabled"`
}

type ScannerConf struct {
	TrivyPath                 string `mapstructure:"trivy_path"`
	Timeout                   int    `mapstructure:"timeout"`
	Concurrency               int    `mapstructure:"concurrency"`
	DBMaxAgeHours             int    `mapstructure:"db_max_age_hours"`
	EnableOSVJavaAugmentation bool   `mapstructure:"enable_osv_java_augmentation"`
}

type EncryptionConf struct {
	Key string `mapstructure:"key"`
}

type VulnKBConf struct {
	NVDApiKey string `mapstructure:"nvd_api_key"`
	CacheDays int    `mapstructure:"cache_days"`
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
		"log_level":                            "BACKEND_LOG_LEVEL",
		"port":                                 "BACKEND_PORT",
		"database.server":                      "BACKEND_DATABASE_SERVER",
		"database.port":                        "BACKEND_DATABASE_PORT",
		"database.name":                        "BACKEND_DATABASE_NAME",
		"database.user":                        "BACKEND_DATABASE_USER",
		"database.password":                    "BACKEND_DATABASE_PASSWORD",
		"scanner.trivy_path":                   "BACKEND_SCANNER_TRIVY_PATH",
		"scanner.timeout":                      "BACKEND_SCANNER_TIMEOUT",
		"scanner.concurrency":                  "BACKEND_SCANNER_CONCURRENCY",
		"scanner.db_max_age_hours":             "BACKEND_SCANNER_DB_MAX_AGE_HOURS",
		"scanner.enable_osv_java_augmentation": "BACKEND_SCANNER_ENABLE_OSV_JAVA_AUGMENTATION",
		"data_path":                            "BACKEND_DATA_PATH",
		"encryption.key":                       "BACKEND_ENCRYPTION_KEY",
		"encryption.master_secret":             "BACKEND_ENCRYPTION_MASTER_SECRET",
		"jwt.secret":                           "BACKEND_JWT_SECRET",
		"runner.shared_runner_secret":          "BACKEND_RUNNER_SHARED_RUNNER_SECRET",
		"oidc.enabled":                         "BACKEND_OIDC_ENABLED",
		"oidc.debug":                           "BACKEND_OIDC_DEBUG",
		"oidc.issuer_url":                      "BACKEND_OIDC_ISSUER_URL",
		"oidc.client_id":                       "BACKEND_OIDC_CLIENT_ID",
		"oidc.client_secret":                   "BACKEND_OIDC_CLIENT_SECRET",
		"oidc.redirect_uri":                    "BACKEND_OIDC_REDIRECT_URI",
		"oidc.scopes":                          "BACKEND_OIDC_SCOPES",
		"oidc.admin_groups":                    "BACKEND_OIDC_ADMIN_GROUPS",
		"oidc.admin_roles":                     "BACKEND_OIDC_ADMIN_ROLES",
		"oidc.groups_claim":                    "BACKEND_OIDC_GROUPS_CLAIM",
		"oidc.roles_claim":                     "BACKEND_OIDC_ROLES_CLAIM",
		"local_auth.enabled":                   "BACKEND_LOCAL_AUTH_ENABLED",
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

func (cm *ConfigurationManager) setDefaults(config *RestfulConf) {
	if config.LogLevel == "" {
		config.LogLevel = "info"
	}
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
	if config.Scanner.Timeout == 0 {
		config.Scanner.Timeout = 600
	}
	if config.Scanner.Concurrency == 0 {
		config.Scanner.Concurrency = 2
	}
	if config.Scanner.DBMaxAgeHours == 0 {
		config.Scanner.DBMaxAgeHours = 24
	}
	config.Scanner.EnableOSVJavaAugmentation = true
	// OIDC defaults
	if config.OIDC.GroupsClaim == "" {
		config.OIDC.GroupsClaim = "groups"
	}
	if config.OIDC.RolesClaim == "" {
		config.OIDC.RolesClaim = "roles"
	}
	if len(config.OIDC.Scopes) == 0 {
		config.OIDC.Scopes = []string{"openid", "email", "profile"}
	}
	// Local auth is enabled by default
	if !cm.viper.IsSet("local_auth.enabled") {
		config.LocalAuth.Enabled = true
	}
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
