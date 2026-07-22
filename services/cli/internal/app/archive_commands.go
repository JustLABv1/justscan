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
	"strconv"
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

type localImageScanOptions struct {
	engine, imageName, imageTag, platform string
	noWait                                bool
	timeout, pollInterval                 time.Duration
}

type archiveScanOptions struct {
	imageName, imageTag, platform, filename string
	noWait                                  bool
	timeout, pollInterval                   time.Duration
}

type uploadProgress struct {
	writer       io.Writer
	label        string
	total        int64
	written      int64
	lastReported int64
	lastUpdate   time.Time
}

type progressReader struct {
	reader   io.Reader
	progress *uploadProgress
}

func (r progressReader) Read(buffer []byte) (int, error) {
	n, err := r.reader.Read(buffer)
	if n > 0 {
		r.progress.add(int64(n))
	}
	return n, err
}

func newUploadProgress(writer io.Writer, label string, total int64) *uploadProgress {
	return &uploadProgress{writer: writer, label: label, total: total}
}

func (p *uploadProgress) wrap(reader io.Reader) io.Reader {
	return progressReader{reader: reader, progress: p}
}

func (p *uploadProgress) add(bytes int64) {
	p.written += bytes
	now := time.Now()
	if p.written-p.lastReported < 5*1024*1024 && now.Sub(p.lastUpdate) < time.Second {
		return
	}
	p.lastReported = p.written
	p.lastUpdate = now
	if p.total > 0 {
		fmt.Fprintf(p.writer, "\r%s: %s / ~%s", p.label, humanBytes(p.written), humanBytes(p.total))
		return
	}
	fmt.Fprintf(p.writer, "\r%s: %s", p.label, humanBytes(p.written))
}

func (p *uploadProgress) finish() {
	if p.written == 0 {
		return
	}
	fmt.Fprintln(p.writer)
}

func humanBytes(value int64) string {
	const unit = 1024
	if value < unit {
		return fmt.Sprintf("%d B", value)
	}
	divisor, exponent := int64(unit), 0
	for value/divisor >= unit && exponent < 3 {
		divisor *= unit
		exponent++
	}
	units := []string{"KiB", "MiB", "GiB", "TiB"}
	return fmt.Sprintf("%.1f %s", float64(value)/float64(divisor), units[exponent])
}

func newLocalImageScanCommand(opt *options) *cobra.Command {
	settings := localImageScanOptions{}
	cmd := &cobra.Command{
		Use:    "local IMAGE",
		Short:  "Stream a local Docker or Podman image to JustScan for remote analysis",
		Hidden: true,
		Args:   cobra.ExactArgs(1),
		RunE:   func(cmd *cobra.Command, args []string) error { return runLocalImageScan(cmd, opt, args[0], settings) },
	}
	addLocalImageScanFlags(cmd, &settings)
	return cmd
}

func addLocalImageScanFlags(cmd *cobra.Command, settings *localImageScanOptions) {
	cmd.Flags().StringVar(&settings.engine, "engine", "docker", "container engine command (for example docker or podman)")
	cmd.Flags().StringVar(&settings.imageName, "name", "", "image name displayed in JustScan")
	cmd.Flags().StringVar(&settings.imageTag, "tag", "", "image tag displayed in JustScan")
	cmd.Flags().StringVar(&settings.platform, "platform", "", "target platform")
	cmd.Flags().BoolVar(&settings.noWait, "no-wait", false, "return after scan acceptance")
	cmd.Flags().DurationVar(&settings.timeout, "timeout", 30*time.Minute, "maximum wait duration")
	cmd.Flags().DurationVar(&settings.pollInterval, "poll-interval", 5*time.Second, "scan status polling interval")
}

func runLocalImageScan(cmd *cobra.Command, opt *options, image string, settings localImageScanOptions) error {
	if err := validateArchiveScanOptions(settings.noWait, settings.timeout, settings.pollInterval, opt.output); err != nil {
		return &exitError{code: 2, err: err}
	}
	estimatedSize, err := localImageSize(cmd.Context(), settings.engine, image)
	if err != nil {
		return &exitError{code: 2, err: err}
	}
	if estimatedSize > maxArchiveBytes {
		return &exitError{code: 2, err: fmt.Errorf("%s image %q is approximately %s, above JustScan's 5 GiB archive upload limit", settings.engine, image, humanBytes(estimatedSize))}
	}
	client, orgID, err := resolveClient(cmd, opt)
	if err != nil {
		return &exitError{code: 2, err: err}
	}
	var stderr bytes.Buffer
	imageExport := exec.CommandContext(cmd.Context(), settings.engine, "image", "save", image)
	imageExport.Stderr = &stderr
	stdout, err := imageExport.StdoutPipe()
	if err != nil {
		return &exitError{code: 2, err: fmt.Errorf("prepare %s image export: %w", settings.engine, err)}
	}
	if err := imageExport.Start(); err != nil {
		return &exitError{code: 2, err: fmt.Errorf("start %s image export: %w", settings.engine, err)}
	}
	if settings.imageName == "" {
		settings.imageName = localImageName(image)
	}
	if settings.imageTag == "" {
		settings.imageTag = localImageTag(image)
	}
	filename := strings.NewReplacer("/", "_", ":", "_").Replace(image) + ".tar"
	archive := io.Reader(stdout)
	var progress *uploadProgress
	if opt.output == "human" {
		progress = newUploadProgress(cmd.ErrOrStderr(), "Uploading local image", estimatedSize)
		archive = progress.wrap(stdout)
	}
	accepted, uploadErr := client.UploadArchive(cmd.Context(), orgID, archive, filename, -1, settings.imageName, settings.imageTag, settings.platform)
	if progress != nil {
		progress.finish()
	}
	stoppedForUploadError := false
	if uploadErr != nil && imageExport.Process != nil {
		_ = imageExport.Process.Kill()
		stoppedForUploadError = true
	}
	waitErr := imageExport.Wait()
	if err := localImageExportError(settings.engine, uploadErr, waitErr, stderr.String(), stoppedForUploadError); err != nil {
		return &exitError{code: 2, err: err}
	}
	return finishUploadedArchiveScan(cmd, opt, client, orgID, accepted, settings.noWait, settings.timeout, settings.pollInterval)
}

func localImageExportError(engine string, uploadErr, waitErr error, stderr string, stoppedForUploadError bool) error {
	if uploadErr != nil && stoppedForUploadError {
		// The upload failure caused us to stop the exporter, so its resulting
		// "signal: killed" exit is expected and must not hide the API error.
		return uploadErr
	}
	if waitErr != nil {
		if message := strings.TrimSpace(stderr); message != "" {
			return fmt.Errorf("%s image export failed: %s", engine, message)
		}
		return fmt.Errorf("%s image export failed: %w", engine, waitErr)
	}
	return uploadErr
}

func localImageSize(ctx context.Context, engine, image string) (int64, error) {
	inspect := exec.CommandContext(ctx, engine, "image", "inspect", "--format", "{{.Size}}", image)
	output, err := inspect.CombinedOutput()
	if err == nil {
		value, parseErr := strconv.ParseInt(strings.TrimSpace(string(output)), 10, 64)
		if parseErr == nil && value >= 0 {
			return value, nil
		}
		return 0, fmt.Errorf("read local image size from %s: unexpected output %q", engine, strings.TrimSpace(string(output)))
	}
	message := strings.TrimSpace(string(output))
	if message != "" && message != "[]" {
		return 0, fmt.Errorf("%s image %q is not available locally: %s; use the exact name or ID from `%s image ls`, pull it first, or use `justscan scan %s` to scan it from the registry", engine, image, message, engine, image)
	}
	return 0, fmt.Errorf("%s image %q is not available locally; use the exact name or ID from `%s image ls`, pull it first, or use `justscan scan %s` to scan it from the registry", engine, image, engine, image)
}

func newArchiveScanCommand(opt *options) *cobra.Command {
	settings := archiveScanOptions{}
	cmd := &cobra.Command{
		Use:    "archive FILE_OR_HTTPS_URL",
		Short:  "Upload an image archive for JustScan to analyze remotely",
		Hidden: true,
		Args:   cobra.ExactArgs(1),
		RunE:   func(cmd *cobra.Command, args []string) error { return runArchiveScan(cmd, opt, args[0], settings) },
	}
	addArchiveScanFlags(cmd, &settings)
	return cmd
}

func addArchiveScanFlags(cmd *cobra.Command, settings *archiveScanOptions) {
	cmd.Flags().StringVar(&settings.imageName, "name", "", "image name displayed in JustScan")
	cmd.Flags().StringVar(&settings.imageTag, "tag", "", "image tag displayed in JustScan")
	cmd.Flags().StringVar(&settings.platform, "platform", "", "target platform")
	cmd.Flags().StringVar(&settings.filename, "filename", "", "archive filename when the URL does not include one")
	cmd.Flags().BoolVar(&settings.noWait, "no-wait", false, "return after scan acceptance")
	cmd.Flags().DurationVar(&settings.timeout, "timeout", 30*time.Minute, "maximum wait duration")
	cmd.Flags().DurationVar(&settings.pollInterval, "poll-interval", 5*time.Second, "scan status polling interval")
}

func runArchiveScan(cmd *cobra.Command, opt *options, sourceArg string, settings archiveScanOptions) error {
	if err := validateArchiveScanOptions(settings.noWait, settings.timeout, settings.pollInterval, opt.output); err != nil {
		return &exitError{code: 2, err: err}
	}
	client, orgID, err := resolveClient(cmd, opt)
	if err != nil {
		return &exitError{code: 2, err: err}
	}
	source, err := openArchiveSource(cmd.Context(), sourceArg)
	if err != nil {
		return &exitError{code: 2, err: err}
	}
	defer source.reader.Close()
	if strings.TrimSpace(settings.filename) != "" {
		source.filename = strings.TrimSpace(settings.filename)
	}
	if settings.imageName == "" {
		settings.imageName = archiveImageName(source.filename)
	}
	if settings.imageTag == "" {
		settings.imageTag = "local"
	}
	accepted, err := client.UploadArchive(cmd.Context(), orgID, source.reader, source.filename, source.size, settings.imageName, settings.imageTag, settings.platform)
	if err != nil {
		return &exitError{code: 2, err: err}
	}
	return finishUploadedArchiveScan(cmd, opt, client, orgID, accepted, settings.noWait, settings.timeout, settings.pollInterval)
}

func validateArchiveScanOptions(noWait bool, timeout, pollInterval time.Duration, output string) error {
	if err := validateOutput(output); err != nil {
		return err
	}
	if !noWait && (timeout <= 0 || pollInterval <= 0) {
		return errors.New("timeout and poll interval must be positive")
	}
	return nil
}

func finishUploadedArchiveScan(cmd *cobra.Command, opt *options, client *Client, orgID string, accepted UploadedArchiveScan, noWait bool, timeout, pollInterval time.Duration) error {
	if noWait {
		return printValue(cmd.OutOrStdout(), opt.output, accepted)
	}
	result, err := waitForScan(cmd, client, orgID, accepted.ID, timeout, pollInterval, opt.output)
	if err != nil {
		return &exitError{code: exitCodeForWaitError(err), err: err}
	}
	if err := printValue(cmd.OutOrStdout(), opt.output, result); err != nil {
		return &exitError{code: 2, err: err}
	}
	return verdictExit(result)
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
