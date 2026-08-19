// Command justscan-mcp runs the local JustScan MCP server over stdio. It is
// intended to be launched by an MCP client such as Claude Desktop, Cursor, or
// another local agent host.
package main

import (
	"context"
	"errors"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"justscan-backend/config"
	"justscan-backend/database"
	mcpserver "justscan-backend/mcp"

	"github.com/alecthomas/kingpin/v2"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	log "github.com/sirupsen/logrus"
)

var (
	configFile = kingpin.Flag("config", "JustScan config file").Short('c').Default("/etc/justscan/config.yaml").String()
	token      = kingpin.Flag("token", "JustScan personal token; prefer JUSTSCAN_MCP_TOKEN").Envar("JUSTSCAN_MCP_TOKEN").String()
)

func main() {
	kingpin.Version("dev")
	kingpin.HelpFlag.Short('h')
	kingpin.Parse()

	if _, err := os.Stat(*configFile); err != nil {
		log.Fatalf("config file not found: %v", err)
	}
	if err := config.GetInstance().LoadConfig(*configFile); err != nil {
		log.Fatalf("failed to load config file: %v", err)
	}
	cfg := config.Config
	configureLogging(cfg.LogLevel)

	if !cfg.MCP.Enabled {
		log.Fatal("MCP is disabled; set mcp.enabled=true in the JustScan config before starting justscan-mcp")
	}
	if strings.TrimSpace(*token) == "" {
		log.Fatal("a JustScan personal token is required; set JUSTSCAN_MCP_TOKEN")
	}

	db := database.StartDatabase(cfg.Database.Driver, cfg.Database.Server, cfg.Database.Port, cfg.Database.User, cfg.Database.Password, cfg.Database.Name)
	if db == nil {
		log.Fatal("failed to connect to the database")
	}
	defer db.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	identity, err := mcpserver.AuthenticatePersonalToken(ctx, db, *token)
	if err != nil {
		log.Fatalf("failed to authenticate MCP token: %v", err)
	}

	server := mcpserver.NewServer(db, identity, cfg.MCP.MaxPageSize)
	if err := server.Run(mcpserver.WithTransport(ctx, mcpserver.TransportStdio), &sdk.StdioTransport{}); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatalf("MCP server stopped: %v", err)
	}
}

func configureLogging(level string) {
	switch strings.ToLower(level) {
	case "debug":
		log.SetLevel(log.DebugLevel)
	case "warn":
		log.SetLevel(log.WarnLevel)
	case "error":
		log.SetLevel(log.ErrorLevel)
	default:
		log.SetLevel(log.InfoLevel)
	}
}
