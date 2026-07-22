package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

const maxArchiveBytes int64 = 5 * 1024 * 1024 * 1024

type archiveSource struct {
	reader   io.ReadCloser
	filename string
	size     int64
}

func newLocalImageScanCommand(opt *options) *cobra.Command {
	var engine, imageName, imageTag, platform string
	cmd := &cobra.Command{
		Use:   "local IMAGE",
		Short: "Stream a local Docker or Podman image to JustScan for remote analysis",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validateOutput(opt.output); err != nil {
				return &exitError{code: 2, err: err}
			}
			client, orgID, err := resolveClient(cmd, opt)
			if err != nil {
				return &exitError{code: 2, err: err}
			}
			var stderr bytes.Buffer
			imageExport := exec.CommandContext(cmd.Context(), engine, "image", "save", args[0])
			imageExport.Stderr = &stderr
			stdout, err := imageExport.StdoutPipe()
			if err != nil {
				return &exitError{code: 2, err: fmt.Errorf("prepare %s image export: %w", engine, err)}
			}
			if err := imageExport.Start(); err != nil {
				return &exitError{code: 2, err: fmt.Errorf("start %s image export: %w", engine, err)}
			}
			if imageName == "" {
				imageName = localImageName(args[0])
			}
			if imageTag == "" {
				imageTag = localImageTag(args[0])
			}
			filename := strings.NewReplacer("/", "_", ":", "_").Replace(args[0]) + ".tar"
			accepted, uploadErr := client.UploadArchive(cmd.Context(), orgID, stdout, filename, -1, imageName, imageTag, platform)
			if uploadErr != nil && imageExport.Process != nil {
				_ = imageExport.Process.Kill()
			}
			waitErr := imageExport.Wait()
			if uploadErr != nil {
				return &exitError{code: 2, err: uploadErr}
			}
			if waitErr != nil {
				message := strings.TrimSpace(stderr.String())
				if message != "" {
					return &exitError{code: 2, err: fmt.Errorf("%s image export failed: %s", engine, message)}
				}
				return &exitError{code: 2, err: fmt.Errorf("%s image export failed: %w", engine, waitErr)}
			}
			return printValue(cmd.OutOrStdout(), opt.output, accepted)
		},
	}
	cmd.Flags().StringVar(&engine, "engine", "docker", "container engine command (for example docker or podman)")
	cmd.Flags().StringVar(&imageName, "name", "", "image name displayed in JustScan")
	cmd.Flags().StringVar(&imageTag, "tag", "", "image tag displayed in JustScan")
	cmd.Flags().StringVar(&platform, "platform", "", "target platform")
	return cmd
}

func newArchiveScanCommand(opt *options) *cobra.Command {
	var imageName, imageTag, platform, filename string
	cmd := &cobra.Command{
		Use:   "archive FILE_OR_HTTPS_URL",
		Short: "Upload an image archive for JustScan to analyze remotely",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validateOutput(opt.output); err != nil {
				return &exitError{code: 2, err: err}
			}
			client, orgID, err := resolveClient(cmd, opt)
			if err != nil {
				return &exitError{code: 2, err: err}
			}
			source, err := openArchiveSource(cmd.Context(), args[0])
			if err != nil {
				return &exitError{code: 2, err: err}
			}
			defer source.reader.Close()
			if strings.TrimSpace(filename) != "" {
				source.filename = strings.TrimSpace(filename)
			}

			if imageName == "" {
				imageName = archiveImageName(source.filename)
			}
			if imageTag == "" {
				imageTag = "local"
			}
			accepted, err := client.UploadArchive(cmd.Context(), orgID, source.reader, source.filename, source.size, imageName, imageTag, platform)
			if err != nil {
				return &exitError{code: 2, err: err}
			}
			return printValue(cmd.OutOrStdout(), opt.output, accepted)
		},
	}
	cmd.Flags().StringVar(&imageName, "name", "", "image name displayed in JustScan")
	cmd.Flags().StringVar(&imageTag, "tag", "", "image tag displayed in JustScan")
	cmd.Flags().StringVar(&platform, "platform", "", "target platform")
	cmd.Flags().StringVar(&filename, "filename", "", "archive filename when the URL does not include one")
	return cmd
}

func openArchiveSource(ctx context.Context, raw string) (archiveSource, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return archiveSource{}, errors.New("archive source is required")
	}
	if parsed, err := url.Parse(trimmed); err == nil && parsed.Scheme != "" {
		if parsed.Scheme != "https" {
			return archiveSource{}, errors.New("remote archive URLs must use HTTPS")
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
		if err != nil {
			return archiveSource{}, fmt.Errorf("create archive download request: %w", err)
		}
		client := &http.Client{
			Timeout: 2 * time.Hour,
			CheckRedirect: func(next *http.Request, _ []*http.Request) error {
				if next.URL.Scheme != "https" {
					return errors.New("remote archive URL redirected to a non-HTTPS location")
				}
				return nil
			},
		}
		response, err := client.Do(request) // #nosec G107 -- URL is explicitly supplied by the CLI user.
		if err != nil {
			return archiveSource{}, fmt.Errorf("download archive: %w", err)
		}
		if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
			response.Body.Close()
			return archiveSource{}, fmt.Errorf("download archive: server returned %s", response.Status)
		}
		if response.Request.URL.Scheme != "https" {
			response.Body.Close()
			return archiveSource{}, errors.New("remote archive URL redirected to a non-HTTPS location")
		}
		if response.ContentLength > maxArchiveBytes {
			response.Body.Close()
			return archiveSource{}, errors.New("archive exceeds the 5 GB upload limit")
		}
		filename := path.Base(response.Request.URL.Path)
		if filename == "." || filename == "/" || filename == "" {
			filename = "image.tar"
		}
		return archiveSource{reader: response.Body, filename: filename, size: response.ContentLength}, nil
	}

	info, err := os.Stat(trimmed)
	if err != nil {
		return archiveSource{}, fmt.Errorf("read archive: %w", err)
	}
	if !info.Mode().IsRegular() {
		return archiveSource{}, errors.New("archive source must be a regular file")
	}
	if info.Size() > maxArchiveBytes {
		return archiveSource{}, errors.New("archive exceeds the 5 GB upload limit")
	}
	file, err := os.Open(trimmed)
	if err != nil {
		return archiveSource{}, fmt.Errorf("open archive: %w", err)
	}
	return archiveSource{reader: file, filename: filepath.Base(trimmed), size: info.Size()}, nil
}

func archiveImageName(filename string) string {
	name := strings.TrimSuffix(filepath.Base(filename), ".gz")
	name = strings.TrimSuffix(name, ".tgz")
	name = strings.TrimSuffix(name, ".tar")
	if name == "" || name == "." {
		return "uploaded-image"
	}
	return name
}

func localImageName(image string) string {
	lastSlash := strings.LastIndex(image, "/")
	lastColon := strings.LastIndex(image, ":")
	if lastColon > lastSlash {
		return image[:lastColon]
	}
	return image
}

func localImageTag(image string) string {
	if lastColon := strings.LastIndex(image, ":"); lastColon > strings.LastIndex(image, "/") {
		return image[lastColon+1:]
	}
	return "local"
}
