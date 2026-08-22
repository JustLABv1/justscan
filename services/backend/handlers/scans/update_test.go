package scans

import (
	"path/filepath"
	"testing"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
)

func TestValidateImmutableImageLocationRejectsTraversalAndAbsolutePaths(t *testing.T) {
	path := filepath.Join(archiveUploadDirectory(uuid.New()), "archive.tar")
	scan := &models.Scan{ScanSource: models.ScanSourceUploadedArchive, ImageLocation: path}
	for _, requested := range []string{
		"../../etc/passwd",
		"/etc/passwd",
		"/tmp/justscan/uploads/other-scan/archive.tar",
		"",
	} {
		requested := requested
		if err := validateImageLocationUpdate(scan, &requested); err == nil {
			t.Fatalf("expected image_location mutation %q to be rejected", requested)
		}
	}
}

func TestValidateImmutableImageLocationAllowsExactNoOp(t *testing.T) {
	path := filepath.Join(archiveUploadDirectory(uuid.New()), "archive.tar")
	if err := validateImageLocationUpdate(&models.Scan{ScanSource: models.ScanSourceUploadedArchive, ImageLocation: path}, &path); err != nil {
		t.Fatalf("expected exact image_location retry to be accepted: %v", err)
	}
}

func TestValidateImageLocationUpdateAllowsRegistryDisplayMetadata(t *testing.T) {
	requested := "registry.example.com/team/image"
	if err := validateImageLocationUpdate(&models.Scan{ScanSource: models.ScanSourceRegistry}, &requested); err != nil {
		t.Fatalf("expected registry location metadata to remain editable: %v", err)
	}
}
