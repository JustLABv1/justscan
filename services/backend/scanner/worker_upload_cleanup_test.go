package scanner

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

func TestCleanupScanArchiveRemovesFile(t *testing.T) {
	uploadID := uuid.New()
	dir := filepath.Join(os.TempDir(), "justscan", "uploads", uploadID.String())
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("failed to create upload directory: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(filepath.Join(os.TempDir(), "justscan", "uploads", uploadID.String())) })
	path := filepath.Join(dir, "image.tar")
	if err := os.WriteFile(path, []byte("archive"), 0o644); err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}

	cleanupScanArchive(uploadID, path)

	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("expected upload directory to be removed, stat err=%v", err)
	}
}

func TestCleanupScanArchiveRefusesOutsideUploadRoot(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "image.tar")
	if err := os.WriteFile(path, []byte("archive"), 0o644); err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}

	cleanupScanArchive(uuid.New(), path)

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected arbitrary path to remain untouched, stat err=%v", err)
	}
}

func TestCleanupScanArchiveRefusesForeignUploadDirectory(t *testing.T) {
	uploadID := uuid.New()
	scanID := uuid.New()
	dir := filepath.Join(os.TempDir(), "justscan", "uploads", uploadID.String())
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("failed to create upload directory: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	path := filepath.Join(dir, "image.tar")
	if err := os.WriteFile(path, []byte("archive"), 0o644); err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}

	cleanupScanArchive(scanID, path)

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected foreign upload archive to remain untouched, stat err=%v", err)
	}
}
