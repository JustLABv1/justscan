package scans

import (
	"mime/multipart"
	"testing"

	"github.com/google/uuid"
)

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
