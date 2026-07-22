package app

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"golang.org/x/term"
)

func newLoginCommand(opt *options) *cobra.Command {
	var email, password string
	var passwordStdin bool
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Sign in and store a user credential in the system keychain",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			profileName, server, caCert, err := resolveLoginTarget(opt)
			if err != nil {
				return &exitError{code: 2, err: err}
			}
			if email == "" {
				fmt.Fprint(cmd.ErrOrStderr(), "Email or username: ")
				value, readErr := bufio.NewReader(cmd.InOrStdin()).ReadString('\n')
				if readErr != nil && !errors.Is(readErr, os.ErrClosed) {
					return &exitError{code: 2, err: fmt.Errorf("read email: %w", readErr)}
				}
				email = strings.TrimSpace(value)
			}
			if strings.TrimSpace(email) == "" {
				return &exitError{code: 2, err: errors.New("email or username is required")}
			}
			if passwordStdin {
				value, readErr := bufio.NewReader(cmd.InOrStdin()).ReadString('\n')
				if readErr != nil && !errors.Is(readErr, os.ErrClosed) {
					return &exitError{code: 2, err: fmt.Errorf("read password: %w", readErr)}
				}
				password = strings.TrimSpace(value)
			} else if password == "" {
				if !term.IsTerminal(int(os.Stdin.Fd())) {
					return &exitError{code: 2, err: errors.New("password prompt requires a terminal; use --password-stdin")}
				}
				fmt.Fprint(cmd.ErrOrStderr(), "Password: ")
				value, readErr := term.ReadPassword(int(os.Stdin.Fd()))
				fmt.Fprintln(cmd.ErrOrStderr())
				if readErr != nil {
					return &exitError{code: 2, err: fmt.Errorf("read password: %w", readErr)}
				}
				password = string(value)
			}
			if strings.TrimSpace(password) == "" {
				return &exitError{code: 2, err: errors.New("password is required")}
			}
			client, err := newClient(server, "", caCert, opt.insecureTLS, opt.allowInsecureHTTP)
			if err != nil {
				return &exitError{code: 2, err: err}
			}
			result, err := client.Login(email, password)
			if err != nil {
				return &exitError{code: 2, err: err}
			}
			if err := storeToken(profileName, server, result.Token); err != nil {
				return &exitError{code: 2, err: err}
			}
			label := firstSet(result.User.Username, result.User.Email, email)
			fmt.Fprintf(cmd.OutOrStdout(), "Signed in as %s\n", label)
			return nil
		},
	}
	cmd.Flags().StringVar(&email, "email", "", "email address or username")
	cmd.Flags().BoolVar(&passwordStdin, "password-stdin", false, "read password from stdin")
	return cmd
}

func newLogoutCommand(opt *options) *cobra.Command {
	return &cobra.Command{
		Use:   "logout",
		Short: "Remove the stored user credential",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			profileName, server, _, err := resolveLoginTarget(opt)
			if err != nil {
				return &exitError{code: 2, err: err}
			}
			if err := deleteStoredToken(profileName, server); err != nil {
				return &exitError{code: 2, err: err}
			}
			fmt.Fprintln(cmd.OutOrStdout(), "Signed out")
			return nil
		},
	}
}

func resolveLoginTarget(opt *options) (string, string, string, error) {
	path, err := configPath(opt)
	if err != nil {
		return "", "", "", err
	}
	cfg, err := loadConfig(path)
	if err != nil {
		return "", "", "", err
	}
	profileName := firstSet(opt.profile, os.Getenv("JUSTSCAN_PROFILE"), cfg.CurrentProfile)
	profile := cfg.Profiles[profileName]
	server := firstSet(opt.server, os.Getenv("JUSTSCAN_URL"), profile.Server)
	caCert := firstSet(opt.caCert, os.Getenv("JUSTSCAN_CA_CERT"), profile.CACert)
	if server == "" {
		return "", "", "", errors.New("server is required; set --server or choose a profile")
	}
	return profileName, server, caCert, nil
}
