package scanner

import (
	"archive/tar"
	"os"
	"path/filepath"
	"testing"
)

func TestPrepareUploadedArchiveInputExtractsOCILayoutTar(t *testing.T) {
	archivePath := writeArchiveInputTestTar(t, map[string]string{
		"oci-layout":                         `{"imageLayoutVersion":"1.0.0"}`,
		"index.json":                         `{"schemaVersion":2,"manifests":[]}`,
		"blobs/sha256/example-image-content": "image content",
	})

	preparedPath, cleanup, err := prepareUploadedArchiveInput(archivePath)
	if err != nil {
		t.Fatalf("prepareUploadedArchiveInput() error = %v", err)
	}
	defer cleanup()
	if preparedPath == archivePath {
		t.Fatal("expected OCI layout tar to be extracted into a directory")
	}

	contents, err := os.ReadFile(filepath.Join(preparedPath, "index.json"))
	if err != nil {
		t.Fatalf("read extracted index.json: %v", err)
	}
	if string(contents) != `{"schemaVersion":2,"manifests":[]}` {
		t.Fatalf("extracted index.json = %q", contents)
	}
}

func TestPrepareUploadedArchiveInputKeepsDockerArchiveFile(t *testing.T) {
	archivePath := writeArchiveInputTestTar(t, map[string]string{"manifest.json": "[]"})

	preparedPath, cleanup, err := prepareUploadedArchiveInput(archivePath)
	if err != nil {
		t.Fatalf("prepareUploadedArchiveInput() error = %v", err)
	}
	defer cleanup()
	if preparedPath != archivePath {
		t.Fatalf("prepared path = %q, want original Docker archive %q", preparedPath, archivePath)
	}
}

func writeArchiveInputTestTar(t *testing.T, files map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "image.tar")
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create tar: %v", err)
	}
	writer := tar.NewWriter(file)
	for name, content := range files {
		if err := writer.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: int64(len(content))}); err != nil {
			t.Fatalf("write tar header: %v", err)
		}
		if _, err := writer.Write([]byte(content)); err != nil {
			t.Fatalf("write tar content: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close tar writer: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close tar file: %v", err)
	}
	return path
}
