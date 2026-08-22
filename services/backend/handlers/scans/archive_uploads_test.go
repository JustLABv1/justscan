package scans

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
)

func TestArchiveUploadRetryReconcilesBytesAfterOffsetUpdateFailure(t *testing.T) {
	sessionID := uuid.New()
	directory := archiveUploadDirectory(sessionID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatalf("create upload directory: %v", err)
	}
	defer os.RemoveAll(directory)

	path := filepath.Join(directory, "image.tar")
	if err := os.WriteFile(path, []byte("base"), 0o600); err != nil {
		t.Fatalf("create archive: %v", err)
	}
	session := &models.ArchiveUploadSession{ID: sessionID, ArchivePath: path, UploadedSize: int64(len("base"))}

	// The append succeeds, but imagine the DB offset update fails afterwards.
	// The durable offset remains four bytes, while the file is eight bytes.
	if _, err := appendArchiveUploadChunk(session, bytes.NewReader([]byte("next"))); err != nil {
		t.Fatalf("append first chunk: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat unapplied archive: %v", err)
	}
	if info.Size() != int64(len("basenext")) {
		t.Fatalf("expected unapplied file bytes after simulated DB failure, size=%v", info.Size())
	}

	if err := reconcileArchiveUploadFile(session); err != nil {
		t.Fatalf("reconcile stale file bytes: %v", err)
	}
	if _, err := appendArchiveUploadChunk(session, bytes.NewReader([]byte("next"))); err != nil {
		t.Fatalf("append retried chunk: %v", err)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read reconciled archive: %v", err)
	}
	if string(contents) != "basenext" {
		t.Fatalf("expected one copy of retried chunk, got %q", contents)
	}
}
