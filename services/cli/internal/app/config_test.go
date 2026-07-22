package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveAndLoadConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "config.json")
	want := Config{CurrentProfile: "work", Profiles: map[string]Profile{
		"work": {Server: "https://scan.example.test", OrgID: "c7a11e8d-82a2-43fc-a978-a0319b1c7130", CACert: "/tmp/ca.pem"},
	}}
	if err := saveConfig(path, want); err != nil {
		t.Fatalf("saveConfig() error = %v", err)
	}
	got, err := loadConfig(path)
	if err != nil {
		t.Fatalf("loadConfig() error = %v", err)
	}
	if got.Version != configVersion || got.CurrentProfile != want.CurrentProfile || got.Profiles["work"] != want.Profiles["work"] {
		t.Fatalf("loaded config = %#v, want %#v", got, want)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("config permissions = %o, want 600", info.Mode().Perm())
	}
}

func TestLoadMissingConfig(t *testing.T) {
	got, err := loadConfig(filepath.Join(t.TempDir(), "missing.json"))
	if err != nil {
		t.Fatalf("loadConfig() error = %v", err)
	}
	if got.Version != configVersion || len(got.Profiles) != 0 {
		t.Fatalf("missing config = %#v", got)
	}
}
