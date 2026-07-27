package scanner

import (
	"archive/tar"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const maxExtractedOCILayoutBytes int64 = 5 * 1024 * 1024 * 1024

// prepareUploadedArchiveInput expands OCI-layout tar archives (including those
// produced by Apple's Container CLI) because Trivy accepts OCI layouts as a
// directory, not as a tar file. Docker archives remain untouched.
func prepareUploadedArchiveInput(archivePath string) (string, func(), error) {
	isLayout, err := isOCILayoutTar(archivePath)
	if err != nil || !isLayout {
		return archivePath, func() {}, err
	}

	directory, err := os.MkdirTemp(filepath.Dir(archivePath), "justscan-oci-layout-*")
	if err != nil {
		return "", nil, fmt.Errorf("create OCI image layout directory: %w", err)
	}
	if err := extractOCILayoutTar(archivePath, directory); err != nil {
		_ = os.RemoveAll(directory)
		return "", nil, err
	}
	return directory, func() { _ = os.RemoveAll(directory) }, nil
}

func isOCILayoutTar(archivePath string) (bool, error) {
	file, err := os.Open(archivePath)
	if err != nil {
		return false, fmt.Errorf("open uploaded archive: %w", err)
	}
	defer file.Close()

	reader := tar.NewReader(file)
	hasIndex, hasLayout := false, false
	for {
		header, err := reader.Next()
		if err == io.EOF {
			return hasIndex && hasLayout, nil
		}
		if err != nil {
			return false, fmt.Errorf("read uploaded archive: %w", err)
		}
		switch strings.TrimPrefix(filepath.ToSlash(filepath.Clean(header.Name)), "./") {
		case "index.json":
			hasIndex = true
		case "oci-layout":
			hasLayout = true
		}
	}
}

func extractOCILayoutTar(archivePath, destination string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return fmt.Errorf("open OCI image archive: %w", err)
	}
	defer file.Close()

	reader := tar.NewReader(file)
	var extracted int64
	for {
		header, err := reader.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("read OCI image archive: %w", err)
		}

		target, err := archiveExtractionPath(destination, header.Name)
		if err != nil {
			return err
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o700); err != nil {
				return fmt.Errorf("create OCI image directory: %w", err)
			}
		case tar.TypeReg, tar.TypeRegA:
			if header.Size < 0 || extracted > maxExtractedOCILayoutBytes-header.Size {
				return fmt.Errorf("OCI image archive expands beyond the 5 GiB upload limit")
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
				return fmt.Errorf("create OCI image file directory: %w", err)
			}
			output, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
			if err != nil {
				return fmt.Errorf("create OCI image file: %w", err)
			}
			_, copyErr := io.Copy(output, reader)
			closeErr := output.Close()
			if copyErr != nil {
				return fmt.Errorf("extract OCI image file: %w", copyErr)
			}
			if closeErr != nil {
				return fmt.Errorf("close OCI image file: %w", closeErr)
			}
			extracted += header.Size
		default:
			return fmt.Errorf("OCI image archive contains unsupported entry type for %q", header.Name)
		}
	}
}

func archiveExtractionPath(destination, name string) (string, error) {
	cleaned := filepath.Clean(name)
	if cleaned == "." {
		return destination, nil
	}
	if filepath.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("OCI image archive contains unsafe path %q", name)
	}
	target := filepath.Join(destination, cleaned)
	relative, err := filepath.Rel(destination, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("OCI image archive contains unsafe path %q", name)
	}
	return target, nil
}
