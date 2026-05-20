package config

import "testing"

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
