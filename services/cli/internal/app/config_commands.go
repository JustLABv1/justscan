package app

import (
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
)

func newConfigCommand(opt *options) *cobra.Command {
	cmd := &cobra.Command{Use: "config", Short: "Manage non-secret JustScan profiles"}
	cmd.AddCommand(newConfigSetCommand(opt), newConfigUseCommand(opt), newConfigShowCommand(opt), newConfigListCommand(opt), newConfigDeleteCommand(opt))
	return cmd
}

func newConfigSetCommand(opt *options) *cobra.Command {
	var server, orgID, caCert string
	cmd := &cobra.Command{
		Use:   "set NAME",
		Short: "Create or update a profile",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if strings.TrimSpace(server) == "" || strings.TrimSpace(orgID) == "" {
				return errors.New("server and org are required")
			}
			if _, err := uuid.Parse(orgID); err != nil {
				return fmt.Errorf("organization must be a UUID: %w", err)
			}
			if _, err := normalizeAPIURL(server, false); err != nil {
				return err
			}
			path, err := configPath(opt)
			if err != nil {
				return err
			}
			cfg, err := loadConfig(path)
			if err != nil {
				return err
			}
			name := strings.TrimSpace(args[0])
			if name == "" {
				return errors.New("profile name is required")
			}
			cfg.Profiles[name] = Profile{Server: strings.TrimRight(strings.TrimSpace(server), "/"), OrgID: strings.TrimSpace(orgID), CACert: strings.TrimSpace(caCert)}
			if cfg.CurrentProfile == "" {
				cfg.CurrentProfile = name
			}
			if err := saveConfig(path, cfg); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Saved profile %q\n", name)
			return nil
		},
	}
	cmd.Flags().StringVar(&server, "server", "", "JustScan instance URL")
	cmd.Flags().StringVar(&orgID, "org", "", "organization UUID")
	cmd.Flags().StringVar(&caCert, "ca-cert", "", "custom CA certificate path")
	return cmd
}

func newConfigUseCommand(opt *options) *cobra.Command {
	return &cobra.Command{
		Use:   "use NAME",
		Short: "Select the active profile",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			path, err := configPath(opt)
			if err != nil {
				return err
			}
			cfg, err := loadConfig(path)
			if err != nil {
				return err
			}
			name := args[0]
			if _, ok := cfg.Profiles[name]; !ok {
				return fmt.Errorf("profile %q does not exist", name)
			}
			cfg.CurrentProfile = name
			if err := saveConfig(path, cfg); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Using profile %q\n", name)
			return nil
		},
	}
}

func newConfigShowCommand(opt *options) *cobra.Command {
	return &cobra.Command{
		Use:   "show [NAME]",
		Short: "Show a profile without credentials",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			path, err := configPath(opt)
			if err != nil {
				return err
			}
			cfg, err := loadConfig(path)
			if err != nil {
				return err
			}
			name := cfg.CurrentProfile
			if len(args) == 1 {
				name = args[0]
			}
			profile, ok := cfg.Profiles[name]
			if !ok {
				return fmt.Errorf("profile %q does not exist", name)
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Profile: %s\nServer: %s\nOrganization: %s\n", name, profile.Server, profile.OrgID)
			if profile.CACert != "" {
				fmt.Fprintf(cmd.OutOrStdout(), "CA certificate: %s\n", profile.CACert)
			}
			return nil
		},
	}
}

func newConfigListCommand(opt *options) *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List profiles",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			path, err := configPath(opt)
			if err != nil {
				return err
			}
			cfg, err := loadConfig(path)
			if err != nil {
				return err
			}
			names := make([]string, 0, len(cfg.Profiles))
			for name := range cfg.Profiles {
				names = append(names, name)
			}
			sort.Strings(names)
			for _, name := range names {
				marker := " "
				if name == cfg.CurrentProfile {
					marker = "*"
				}
				fmt.Fprintf(cmd.OutOrStdout(), "%s %s\t%s\t%s\n", marker, name, cfg.Profiles[name].Server, cfg.Profiles[name].OrgID)
			}
			return nil
		},
	}
}

func newConfigDeleteCommand(opt *options) *cobra.Command {
	return &cobra.Command{
		Use:   "delete NAME",
		Short: "Delete a profile",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			path, err := configPath(opt)
			if err != nil {
				return err
			}
			cfg, err := loadConfig(path)
			if err != nil {
				return err
			}
			name := args[0]
			if _, ok := cfg.Profiles[name]; !ok {
				return fmt.Errorf("profile %q does not exist", name)
			}
			delete(cfg.Profiles, name)
			if cfg.CurrentProfile == name {
				cfg.CurrentProfile = ""
			}
			if err := saveConfig(path, cfg); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Deleted profile %q\n", name)
			return nil
		},
	}
}
