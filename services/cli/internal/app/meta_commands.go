package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

const latestReleaseURL = "https://api.github.com/repos/JustLABv1/justscan/releases/latest"

type releaseInfo struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
}

func newVersionCommand(opt *options) *cobra.Command {
	var check bool
	cmd := &cobra.Command{
		Use:   "version",
		Short: "Print CLI version information and optionally check for updates",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			fmt.Fprintf(cmd.OutOrStdout(), "justscan %s (commit %s, built %s)\n", opt.version, opt.commit, opt.date)
			if !check {
				return nil
			}
			latest, err := checkLatestRelease()
			if err != nil {
				return err
			}
			comparison, comparable := compareReleaseVersions(opt.version, latest.TagName)
			switch {
			case !comparable:
				fmt.Fprintf(cmd.OutOrStdout(), "Latest release: %s\n", latest.TagName)
			case comparison < 0:
				fmt.Fprintf(cmd.OutOrStdout(), "Update available: %s → %s\nGet it here: %s\n", opt.version, latest.TagName, latest.HTMLURL)
			default:
				fmt.Fprintf(cmd.OutOrStdout(), "You are up to date (%s).\n", latest.TagName)
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&check, "check", false, "check GitHub for a newer release")
	return cmd
}

func checkLatestRelease() (releaseInfo, error) {
	request, err := http.NewRequest(http.MethodGet, latestReleaseURL, nil)
	if err != nil {
		return releaseInfo{}, fmt.Errorf("create update check request: %w", err)
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "justscan-cli")
	response, err := (&http.Client{Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		return releaseInfo{}, fmt.Errorf("check for updates: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return releaseInfo{}, fmt.Errorf("check for updates: release service returned %s", response.Status)
	}
	var latest releaseInfo
	if err := json.NewDecoder(response.Body).Decode(&latest); err != nil {
		return releaseInfo{}, fmt.Errorf("read latest release: %w", err)
	}
	if strings.TrimSpace(latest.TagName) == "" || strings.TrimSpace(latest.HTMLURL) == "" {
		return releaseInfo{}, errors.New("check for updates: release service returned incomplete data")
	}
	return latest, nil
}

func compareReleaseVersions(current, latest string) (int, bool) {
	parse := func(value string) ([3]int, bool) {
		var parsed [3]int
		value = strings.TrimPrefix(strings.TrimSpace(value), "v")
		if strings.Contains(value, "-") {
			return parsed, false
		}
		parts := strings.Split(value, ".")
		if len(parts) != 3 {
			return parsed, false
		}
		for index, part := range parts {
			parsedValue, err := strconv.Atoi(part)
			if err != nil || parsedValue < 0 {
				return parsed, false
			}
			parsed[index] = parsedValue
		}
		return parsed, true
	}
	currentParts, currentOK := parse(current)
	latestParts, latestOK := parse(latest)
	if !currentOK || !latestOK {
		return 0, false
	}
	for index := range currentParts {
		if currentParts[index] < latestParts[index] {
			return -1, true
		}
		if currentParts[index] > latestParts[index] {
			return 1, true
		}
	}
	return 0, true
}

func newCompletionCommand(root *cobra.Command) *cobra.Command {
	return &cobra.Command{
		Use:       "completion [bash|zsh|fish|powershell]",
		Short:     "Generate shell completion scripts",
		Args:      cobra.ExactArgs(1),
		ValidArgs: []string{"bash", "zsh", "fish", "powershell"},
		RunE: func(cmd *cobra.Command, args []string) error {
			switch args[0] {
			case "bash":
				return root.GenBashCompletion(cmd.OutOrStdout())
			case "zsh":
				return root.GenZshCompletion(cmd.OutOrStdout())
			case "fish":
				return root.GenFishCompletion(cmd.OutOrStdout(), true)
			case "powershell":
				return root.GenPowerShellCompletionWithDesc(cmd.OutOrStdout())
			default:
				return fmt.Errorf("unsupported shell %q", args[0])
			}
		},
	}
}

var _ = os.Stdout
