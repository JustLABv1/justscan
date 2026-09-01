package config

import (
	"path/filepath"
	"testing"

	"github.com/spf13/viper"
)

func TestLoadConfigAllowsEnvironmentOnlyConfiguration(t *testing.T) {
	t.Setenv("BACKEND_DATABASE_SERVER", "postgres")
	t.Setenv("BACKEND_DATABASE_NAME", "justscan")
	t.Setenv("BACKEND_DATABASE_PASSWORD", "database-password")
	t.Setenv("BACKEND_JWT_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("BACKEND_ENCRYPTION_KEY", "fedcba9876543210fedcba9876543210")

	cm := &ConfigurationManager{viper: viper.New()}
	missingPath := filepath.Join(t.TempDir(), "config.yaml")
	if err := cm.LoadConfig(missingPath); err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cm.config.Database.Server != "postgres" {
		t.Fatalf("database server = %q, want postgres", cm.config.Database.Server)
	}
}

func TestValidateRejectsWeakSecretsByDefault(t *testing.T) {
	cm := &ConfigurationManager{}
	cfg := &RestfulConf{
		JWT:        JWTConf{Secret: "short"},
		Encryption: EncryptionConf{Key: "short"},
	}

	err := cm.validate(cfg)
	if err == nil {
		t.Fatal("expected validation error for weak secrets")
	}
}

func TestValidateAllowsWeakSecretsWithExplicitEscapeHatch(t *testing.T) {
	cm := &ConfigurationManager{}
	cfg := &RestfulConf{
		Security:   SecurityConf{AllowInsecureDefaults: true},
		JWT:        JWTConf{Secret: "short"},
		Encryption: EncryptionConf{Key: "short"},
	}

	if err := cm.validate(cfg); err != nil {
		t.Fatalf("expected validation to pass with insecure escape hatch, got %v", err)
	}
}

func TestValidateAcceptsStrongSecrets(t *testing.T) {
	cm := &ConfigurationManager{}
	cfg := &RestfulConf{
		JWT:        JWTConf{Secret: "0123456789abcdef0123456789abcdef"},
		Encryption: EncryptionConf{Key: "fedcba9876543210fedcba9876543210"},
	}

	if err := cm.validate(cfg); err != nil {
		t.Fatalf("expected validation to pass with strong secrets, got %v", err)
	}
}

func TestValidateRejectsUnsafeMCPEndpoint(t *testing.T) {
	cm := &ConfigurationManager{}
	cfg := &RestfulConf{
		MCP:        MCPConf{Endpoint: "../mcp"},
		JWT:        JWTConf{Secret: "0123456789abcdef0123456789abcdef"},
		Encryption: EncryptionConf{Key: "fedcba9876543210fedcba9876543210"},
	}
	if err := cm.validate(cfg); err == nil {
		t.Fatal("expected invalid MCP endpoint to be rejected")
	}
}

func TestValidateRejectsOversizedMCPRequest(t *testing.T) {
	cm := &ConfigurationManager{}
	cfg := &RestfulConf{
		MCP:        MCPConf{Endpoint: "/mcp", MaxRequestBodyBytes: 17 << 20},
		JWT:        JWTConf{Secret: "0123456789abcdef0123456789abcdef"},
		Encryption: EncryptionConf{Key: "fedcba9876543210fedcba9876543210"},
	}
	if err := cm.validate(cfg); err == nil {
		t.Fatal("expected oversized MCP request body to be rejected")
	}
}
