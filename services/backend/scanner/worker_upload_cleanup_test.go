package scanner

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

func TestCleanupScanArchiveRemovesFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "image.tar")
	if err := os.WriteFile(path, []byte("archive"), 0o644); err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}

	cleanupScanArchive(uuid.New(), path)

	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected file to be removed, stat err=%v", err)
	}
}
