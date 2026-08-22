package scans

import (
	"mime/multipart"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

func TestIsArchiveUploadPathRejectsTraversalAndAbsolutePath(t *testing.T) {
	id := uuid.New()
	directory := archiveUploadDirectory(id)
	valid := filepath.Join(directory, "image.tar")
	if !isArchiveUploadPath(id, valid) {
		t.Fatal("expected direct archive path to be accepted")
	}
	for _, path := range []string{
		filepath.Join(directory, "nested", "image.tar"),
		filepath.Join(directory, "..", "other", "image.tar"),
		"/etc/passwd",
	} {
		if isArchiveUploadPath(id, path) {
			t.Fatalf("expected unsafe archive path %q to be rejected", path)
		}
	}
}

func TestValidateUploadedArchiveFile(t *testing.T) {
	valid := &multipart.FileHeader{Filename: "image.tar", Size: 1024}
	if err := validateUploadedArchiveFile(valid); err != nil {
		t.Fatalf("expected valid archive, got error: %v", err)
	}

	invalidExt := &multipart.FileHeader{Filename: "image.txt", Size: 1024}
	if err := validateUploadedArchiveFile(invalidExt); err == nil {
		t.Fatal("expected invalid extension error")
	}

	tooLarge := &multipart.FileHeader{Filename: "image.tar", Size: maxUploadedArchiveBytes + 1}
	if err := validateUploadedArchiveFile(tooLarge); err == nil {
		t.Fatal("expected oversized archive error")
	}
}

func TestParseTagIDList(t *testing.T) {
	id1 := uuid.New()
	id2 := uuid.New()
	parsed := parseTagIDList(id1.String() + ",invalid," + id2.String())
	if len(parsed) != 2 {
		t.Fatalf("expected 2 parsed tag ids, got %d", len(parsed))
	}
	if parsed[0] != id1 || parsed[1] != id2 {
		t.Fatalf("unexpected parsed order: %+v", parsed)
	}
}
