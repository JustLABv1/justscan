package app

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
)

type exitError struct {
	code int
	err  error
}

func (e *exitError) Error() string { return e.err.Error() }

type options struct {
	server            string
	orgID             string
	profile           string
	configPath        string
	caCert            string
	insecureTLS       bool
	allowInsecureHTTP bool
	tokenStdin        bool
	output            string
	version           string
	commit            string
	date              string
}

func Execute(version, commit, date string) int {
	root := newRoot(version, commit, date)
	if err := root.Execute(); err != nil {
		var exit *exitError
		if errors.As(err, &exit) {
			fmt.Fprintln(root.ErrOrStderr(), "error:", exit.err)
			return exit.code
		}
		fmt.Fprintln(root.ErrOrStderr(), "error:", err)
		return 2
	}
	return 0
}

func newRoot(version, commit, date string) *cobra.Command {
	opt := &options{version: version, commit: commit, date: date, output: "human"}
	root := &cobra.Command{
		Use:           "justscan",
		Short:         "Interact with a running JustScan instance",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.PersistentFlags().StringVar(&opt.server, "server", "", "JustScan instance URL")
	root.PersistentFlags().StringVar(&opt.orgID, "org", "", "organization UUID")
	root.PersistentFlags().StringVar(&opt.profile, "profile", "", "named configuration profile")
	root.PersistentFlags().StringVar(&opt.configPath, "config", "", "configuration file path")
	root.PersistentFlags().StringVar(&opt.caCert, "ca-cert", "", "custom CA certificate path")
	root.PersistentFlags().BoolVar(&opt.insecureTLS, "insecure-skip-tls-verify", false, "skip TLS certificate verification")
	root.PersistentFlags().BoolVar(&opt.allowInsecureHTTP, "allow-insecure-http", false, "allow HTTP to non-loopback hosts")
	root.PersistentFlags().BoolVar(&opt.tokenStdin, "token-stdin", false, "read bearer token from stdin")
	root.PersistentFlags().StringVarP(&opt.output, "output", "o", "human", "output format: human or json")
	scanCommand := newScanCommand(opt)
	scanCommand.AddCommand(newArchiveScanCommand(opt), newLocalImageScanCommand(opt))
	// Keep the former subcommands and top-level commands as compatibility aliases.
	root.AddCommand(newLoginCommand(opt), newLogoutCommand(opt), scanCommand, newArchiveScanCommand(opt), newLocalImageScanCommand(opt), newStatusCommand(opt), newConfigCommand(opt), newVersionCommand(opt), newCompletionCommand(root))
	return root
}

func configPath(opt *options) (string, error) {
	if opt.configPath != "" {
		return opt.configPath, nil
	}
	return defaultConfigPath()
}

func resolveClient(cmd *cobra.Command, opt *options) (*Client, string, error) {
	path, err := configPath(opt)
	if err != nil {
		return nil, "", err
	}
	cfg, err := loadConfig(path)
	if err != nil {
		return nil, "", err
	}
	profileName := opt.profile
	if profileName == "" {
		profileName = os.Getenv("JUSTSCAN_PROFILE")
	}
	if profileName == "" {
		profileName = cfg.CurrentProfile
	}
	profile := cfg.Profiles[profileName]
	server := firstSet(opt.server, os.Getenv("JUSTSCAN_URL"), profile.Server)
	orgID := firstSet(opt.orgID, os.Getenv("JUSTSCAN_ORG_ID"), profile.OrgID)
	caCert := firstSet(opt.caCert, os.Getenv("JUSTSCAN_CA_CERT"), profile.CACert)
	if server == "" || orgID == "" {
		return nil, "", errors.New("server and organization are required; set flags, JUSTSCAN_URL/JUSTSCAN_ORG_ID, or a profile")
	}
	if _, err := uuid.Parse(orgID); err != nil {
		return nil, "", fmt.Errorf("organization must be a UUID: %w", err)
	}
	token, err := resolveToken(opt, profileName, server)
	if err != nil {
		return nil, "", err
	}
	insecureTLS := opt.insecureTLS || boolEnv("JUSTSCAN_INSECURE_SKIP_TLS_VERIFY")
	allowHTTP := opt.allowInsecureHTTP || boolEnv("JUSTSCAN_ALLOW_INSECURE_HTTP")
	client, err := newClient(server, token, caCert, insecureTLS, allowHTTP)
	if err != nil {
		return nil, "", err
	}
	if insecureTLS {
		fmt.Fprintln(cmd.ErrOrStderr(), "warning: TLS certificate verification is disabled")
	}
	return client, orgID, nil
}

func firstSet(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func boolEnv(name string) bool {
	value, err := strconvParseBool(os.Getenv(name))
	return err == nil && value
}

func strconvParseBool(value string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true, nil
	case "", "0", "false", "no", "off":
		return false, nil
	default:
		return false, errors.New("invalid boolean")
	}
}

func resolveToken(opt *options, profileName, server string) (string, error) {
	if opt.tokenStdin {
		reader := bufio.NewReader(io.LimitReader(os.Stdin, 8193))
		value, err := reader.ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return "", fmt.Errorf("read token from stdin: %w", err)
		}
		if len(value) > 8192 {
			return "", errors.New("token from stdin exceeds 8 KiB")
		}
		if token := strings.TrimSpace(value); token != "" {
			return token, nil
		}
		return "", errors.New("token from stdin is empty")
	}
	if token := strings.TrimSpace(os.Getenv("JUSTSCAN_TOKEN")); token != "" {
		return token, nil
	}
	if token, err := loadStoredToken(profileName, server); err != nil {
		return "", err
	} else if token != "" {
		return token, nil
	}
	return "", errors.New("authentication required; run 'justscan login' or set JUSTSCAN_TOKEN for CI")
}

func newScanCommand(opt *options) *cobra.Command {
	var registryID, platform, xrayRepository, source, externalRef string
	var tagIDs []string
	var noWait, localMode bool
	var archiveSource string
	var engine, imageName, imageTag, archiveFilename string
	var timeout, pollInterval time.Duration
	cmd := &cobra.Command{
		Use:   "scan IMAGE | scan --local IMAGE | scan --archive FILE_OR_HTTPS_URL",
		Short: "Submit an image scan and wait for its policy verdict",
		Args: func(cmd *cobra.Command, args []string) error {
			if localMode && archiveSource != "" {
				return errors.New("--local and --archive cannot be used together")
			}
			if archiveSource != "" {
				if len(args) != 0 {
					return errors.New("scan --archive accepts the archive path or URL as the flag value, not a positional image")
				}
				return nil
			}
			return cobra.ExactArgs(1)(cmd, args)
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			if localMode {
				return runLocalImageScan(cmd, opt, args[0], localImageScanOptions{engine: engine, imageName: imageName, imageTag: imageTag, platform: platform, noWait: noWait, timeout: timeout, pollInterval: pollInterval})
			}
			if archiveSource != "" {
				return runArchiveScan(cmd, opt, archiveSource, archiveScanOptions{imageName: imageName, imageTag: imageTag, platform: platform, filename: archiveFilename, noWait: noWait, timeout: timeout, pollInterval: pollInterval})
			}
			if err := validateOutput(opt.output); err != nil {
				return &exitError{code: 2, err: err}
			}
			if err := validateScanOptions(registryID, tagIDs, source, timeout, pollInterval, noWait); err != nil {
				return &exitError{code: 2, err: err}
			}
			client, orgID, err := resolveClient(cmd, opt)
			if err != nil {
				return &exitError{code: 2, err: err}
			}
			accepted, err := client.CreateScan(orgID, ScanRequest{Image: args[0], Platform: platform, RegistryID: registryID, XrayRepository: xrayRepository, TagIDs: tagIDs, Source: source, ExternalRef: externalRef})
			if err != nil {
				return &exitError{code: 2, err: err}
			}
			if noWait {
				return printValue(cmd.OutOrStdout(), opt.output, accepted)
			}
			result, err := waitForScan(cmd, client, orgID, accepted.ScanID, timeout, pollInterval, opt.output)
			if err != nil {
				return &exitError{code: exitCodeForWaitError(err), err: err}
			}
			if err := printValue(cmd.OutOrStdout(), opt.output, result); err != nil {
				return &exitError{code: 2, err: err}
			}
			return verdictExit(result)
		},
	}
	cmd.Flags().StringVar(&registryID, "registry-id", "", "registry UUID")
	cmd.Flags().StringVar(&platform, "platform", "", "target platform")
	cmd.Flags().StringVar(&xrayRepository, "xray-repository", "", "Artifactory Xray repository")
	cmd.Flags().StringSliceVar(&tagIDs, "tag-id", nil, "scan tag UUID (repeatable)")
	cmd.Flags().StringVar(&source, "source", "justscan_cli", "pipeline source")
	cmd.Flags().StringVar(&externalRef, "external-ref", "", "external build or pipeline reference")
	cmd.Flags().DurationVar(&timeout, "timeout", 30*time.Minute, "maximum wait duration")
	cmd.Flags().DurationVar(&pollInterval, "poll-interval", 5*time.Second, "scan status polling interval")
	cmd.Flags().BoolVar(&noWait, "no-wait", false, "return after scan acceptance")
	cmd.Flags().BoolVar(&localMode, "local", false, "scan an image from the local Docker, Podman, or Apple Container engine")
	cmd.Flags().StringVar(&archiveSource, "archive", "", "scan an image archive from disk or an HTTPS URL")
	cmd.Flags().StringVar(&engine, "engine", "docker", "container engine command for --local (for example docker, podman, or container)")
	cmd.Flags().StringVar(&imageName, "name", "", "image name displayed in JustScan for --local or --archive")
	cmd.Flags().StringVar(&imageTag, "tag", "", "image tag displayed in JustScan for --local or --archive")
	cmd.Flags().StringVar(&archiveFilename, "filename", "", "archive filename when --archive URL does not include one")
	return cmd
}

func newStatusCommand(opt *options) *cobra.Command {
	var wait bool
	var timeout, pollInterval time.Duration
	cmd := &cobra.Command{
		Use:   "status SCAN_ID",
		Short: "Show the current state of a pipeline scan",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validateOutput(opt.output); err != nil {
				return &exitError{code: 2, err: err}
			}
			if _, err := uuid.Parse(args[0]); err != nil {
				return &exitError{code: 2, err: fmt.Errorf("scan ID must be a UUID: %w", err)}
			}
			if timeout <= 0 || pollInterval <= 0 {
				return &exitError{code: 2, err: errors.New("timeout and poll interval must be positive")}
			}
			client, orgID, err := resolveClient(cmd, opt)
			if err != nil {
				return &exitError{code: 2, err: err}
			}
			var result ScanResult
			if wait {
				result, err = waitForScan(cmd, client, orgID, args[0], timeout, pollInterval, opt.output)
			} else {
				result, err = client.GetScan(orgID, args[0])
			}
			if err != nil {
				return &exitError{code: exitCodeForWaitError(err), err: err}
			}
			if err := printValue(cmd.OutOrStdout(), opt.output, result); err != nil {
				return &exitError{code: 2, err: err}
			}
			return verdictExit(result)
		},
	}
	cmd.Flags().BoolVar(&wait, "wait", false, "wait for a terminal verdict")
	cmd.Flags().DurationVar(&timeout, "timeout", 30*time.Minute, "maximum wait duration")
	cmd.Flags().DurationVar(&pollInterval, "poll-interval", 5*time.Second, "scan status polling interval")
	return cmd
}

func validateScanOptions(registryID string, tagIDs []string, source string, timeout, interval time.Duration, noWait bool) error {
	if registryID != "" {
		if _, err := uuid.Parse(registryID); err != nil {
			return fmt.Errorf("registry ID must be a UUID: %w", err)
		}
	}
	for _, tagID := range tagIDs {
		if _, err := uuid.Parse(tagID); err != nil {
			return fmt.Errorf("tag ID must be a UUID: %w", err)
		}
	}
	if !contains([]string{"generic", "justscan_cli", "github_actions", "gitlab_ci", "n8n"}, source) {
		return errors.New("source must be justscan_cli, generic, github_actions, gitlab_ci, or n8n")
	}
	if !noWait && (timeout <= 0 || interval <= 0) {
		return errors.New("timeout and poll interval must be positive")
	}
	return nil
}

func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}

func validateOutput(format string) error {
	if format != "human" && format != "json" {
		return errors.New("output must be human or json")
	}
	return nil
}

func waitForScan(cmd *cobra.Command, client *Client, orgID, scanID string, timeout, interval time.Duration, output string) (ScanResult, error) {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var lastState string
	failures := 0
	for {
		if err := ctx.Err(); err != nil {
			if errors.Is(err, context.Canceled) {
				return ScanResult{}, errors.New("scan wait interrupted")
			}
			return ScanResult{}, fmt.Errorf("scan did not reach a terminal verdict within %s", timeout)
		}
		result, err := client.GetScan(orgID, scanID)
		if err == nil {
			failures = 0
			state := result.Status + ":" + result.CurrentStep
			if output == "human" && state != lastState {
				fmt.Fprintf(cmd.ErrOrStderr(), "scan %s: %s (%s)\n", result.ScanID, result.Status, result.CurrentStep)
				lastState = state
			}
			if result.Verdict != "pending" {
				return result, nil
			}
		} else if !retriablePollError(err) {
			return ScanResult{}, err
		} else {
			failures++
		}
		delay := pollDelay(interval, failures, err)
		select {
		case <-ctx.Done():
		case <-time.After(delay):
		}
	}
}

func retriablePollError(err error) bool {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.StatusCode == 429 || apiErr.StatusCode >= 500
	}
	return strings.Contains(err.Error(), "call JustScan API")
}

func pollDelay(interval time.Duration, failures int, err error) time.Duration {
	if failures == 0 {
		return interval
	}
	delay := interval
	for i := 1; i < failures && delay < 30*time.Second; i++ {
		delay *= 2
	}
	if delay > 30*time.Second {
		delay = 30 * time.Second
	}
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.RetryAfter > delay {
		delay = apiErr.RetryAfter
	}
	return delay
}

func exitCodeForWaitError(err error) int {
	if strings.Contains(err.Error(), "interrupted") {
		return 130
	}
	return 2
}

func verdictExit(result ScanResult) error {
	switch result.Verdict {
	case "pass", "pending":
		return nil
	case "fail":
		return &exitError{code: 1, err: errors.New("scan verdict failed")}
	case "error":
		if message := strings.TrimSpace(result.ErrorMessage); message != "" {
			return &exitError{code: 2, err: fmt.Errorf("scan execution failed: %s", message)}
		}
		return &exitError{code: 2, err: errors.New("scan verdict returned an error")}
	default:
		return &exitError{code: 2, err: fmt.Errorf("unknown scan verdict %q", result.Verdict)}
	}
}

func printValue(w io.Writer, format string, value any) error {
	switch format {
	case "json":
		encoder := json.NewEncoder(w)
		return encoder.Encode(value)
	case "human":
		switch result := value.(type) {
		case AcceptedScan:
			_, err := fmt.Fprintf(w, "Scan accepted\nID: %s\nStatus: %s\n", result.ScanID, result.ScanStatus)
			return err
		case UploadedArchiveScan:
			_, err := fmt.Fprintf(w, "Archive scan accepted\nID: %s\nImage: %s:%s\nStatus: %s\n", result.ID, result.ImageName, result.ImageTag, result.Status)
			return err
		case ScanResult:
			_, err := fmt.Fprintf(w, "Scan %s\nImage: %s:%s\nProvider: %s\nStatus: %s\nVerdict: %s\nVulnerabilities: critical=%d high=%d medium=%d low=%d unknown=%d\n%s", result.ScanID, result.ImageName, result.ImageTag, result.ScanProvider, result.Status, result.Verdict, result.CriticalCount, result.HighCount, result.MediumCount, result.LowCount, result.UnknownCount, scanURLLine(result.ScanURL))
			return err
		default:
			return fmt.Errorf("unsupported output value %T", value)
		}
	default:
		return errors.New("output must be human or json")
	}
}

func scanURLLine(scanURL string) string {
	if scanURL == "" {
		return ""
	}
	return "Scan URL: " + scanURL + "\n"
}
