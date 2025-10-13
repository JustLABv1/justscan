package config

import (
	"fmt"
	"os"

	log "github.com/sirupsen/logrus"
	"gopkg.in/yaml.v3"
)

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	VPS      VPSConfig      `yaml:"vps"`
	Bridge   BridgeConfig   `yaml:"bridge"`
	Logging  LoggingConfig  `yaml:"logging"`
	Security SecurityConfig `yaml:"security"`
}

type ServerConfig struct {
	Host           string   `yaml:"host"`
	Port           int      `yaml:"port"`
	UploadDir      string   `yaml:"upload_dir"`
	MaxFileSize    int64    `yaml:"max_file_size"`
	AllowedOrigins []string `yaml:"allowed_origins"`
}

type VPSConfig struct {
	BaseURL          string `yaml:"base_url"`
	APIToken         string `yaml:"api_token"`
	RegisterInterval int    `yaml:"register_interval"`
}

type BridgeConfig struct {
	ServiceID   string `yaml:"service_id"`
	ServiceName string `yaml:"service_name"`
	Version     string `yaml:"version"`
}

type LoggingConfig struct {
	Level  string `yaml:"level"`
	Format string `yaml:"format"`
}

type SecurityConfig struct {
	APIKey         string   `yaml:"api_key"`
	EnableCORS     bool     `yaml:"enable_cors"`
	TrustedProxies []string `yaml:"trusted_proxies"`
}

func LoadConfig(configPath string) (*Config, error) {
	config := &Config{}

	// Set default values
	config.Server.Host = "0.0.0.0"
	config.Server.Port = 8080
	config.Server.UploadDir = "/var/csv-files"
	config.Server.MaxFileSize = 10485760 // 10MB
	config.Server.AllowedOrigins = []string{"*"}
	config.Logging.Level = "info"
	config.Logging.Format = "json"
	config.Security.EnableCORS = true

	// Read config file if it exists
	if configPath != "" {
		data, err := os.ReadFile(configPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read config file: %w", err)
		}

		if err := yaml.Unmarshal(data, config); err != nil {
			return nil, fmt.Errorf("failed to parse config file: %w", err)
		}
	}

	// Override with environment variables if set
	if host := os.Getenv("CSV_BRIDGE_HOST"); host != "" {
		config.Server.Host = host
	}
	if port := os.Getenv("CSV_BRIDGE_PORT"); port != "" {
		var portInt int
		if _, err := fmt.Sscanf(port, "%d", &portInt); err == nil {
			config.Server.Port = portInt
		}
	}
	if uploadDir := os.Getenv("CSV_BRIDGE_UPLOAD_DIR"); uploadDir != "" {
		config.Server.UploadDir = uploadDir
	}
	if vpsURL := os.Getenv("CSV_BRIDGE_VPS_URL"); vpsURL != "" {
		config.VPS.BaseURL = vpsURL
	}
	if apiToken := os.Getenv("CSV_BRIDGE_API_TOKEN"); apiToken != "" {
		config.VPS.APIToken = apiToken
	}
	if apiKey := os.Getenv("CSV_BRIDGE_API_KEY"); apiKey != "" {
		config.Security.APIKey = apiKey
	}

	// Validate required fields
	if config.VPS.BaseURL == "" {
		return nil, fmt.Errorf("VPS base URL is required")
	}
	if config.VPS.APIToken == "" {
		return nil, fmt.Errorf("VPS API token is required")
	}
	if config.Security.APIKey == "" {
		return nil, fmt.Errorf("Bridge service API key is required")
	}

	// Set up logging
	switch config.Logging.Level {
	case "debug":
		log.SetLevel(log.DebugLevel)
	case "warn":
		log.SetLevel(log.WarnLevel)
	case "error":
		log.SetLevel(log.ErrorLevel)
	default:
		log.SetLevel(log.InfoLevel)
	}

	if config.Logging.Format == "json" {
		log.SetFormatter(&log.JSONFormatter{})
	} else {
		log.SetFormatter(&log.TextFormatter{})
	}

	return config, nil
}
