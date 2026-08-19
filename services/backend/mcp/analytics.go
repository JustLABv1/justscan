package mcpserver

import (
	"context"
	"errors"
	"strings"
	"time"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

const (
	TransportHTTP  = "http"
	TransportStdio = "stdio"

	MCPRuntimeModeEnabled  = "enabled"
	MCPRuntimeModeReadOnly = "read_only"
	MCPRuntimeModeDisabled = "disabled"
	MCPRuntimeModeKey      = "mcp.runtime_mode"
)

var (
	errMCPRuntimeDisabled = errors.New("MCP is disabled by an administrator")
	errMCPRuntimeReadOnly = errors.New("MCP is in read-only mode; action tools are disabled")
)

type transportContextKey struct{}

// WithTransport marks a tool-call context with the transport that initiated it.
// The stdio command and HTTP adapter set this before handing control to the SDK.
func WithTransport(ctx context.Context, transport string) context.Context {
	if strings.TrimSpace(transport) == "" {
		transport = TransportStdio
	}
	return context.WithValue(ctx, transportContextKey{}, transport)
}

func transportFromContext(ctx context.Context) string {
	if value, ok := ctx.Value(transportContextKey{}).(string); ok && value != "" {
		return value
	}
	return TransportStdio
}

// LoadRuntimeMode reads the dynamic admin kill switch directly from the
// database so a running stdio process observes changes without a restart.
func LoadRuntimeMode(ctx context.Context, db *bun.DB) string {
	if db == nil {
		return MCPRuntimeModeEnabled
	}

	var setting models.SystemSetting
	if err := db.NewSelect().Model(&setting).Where("key = ?", MCPRuntimeModeKey).Scan(ctx); err != nil {
		return MCPRuntimeModeEnabled
	}
	return normalizeRuntimeMode(setting.Value)
}

func normalizeRuntimeMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case MCPRuntimeModeReadOnly:
		return MCPRuntimeModeReadOnly
	case MCPRuntimeModeDisabled:
		return MCPRuntimeModeDisabled
	default:
		return MCPRuntimeModeEnabled
	}
}

func (s *server) requireRuntime(ctx context.Context, action bool) error {
	switch mode := LoadRuntimeMode(ctx, s.db); mode {
	case MCPRuntimeModeDisabled:
		return errMCPRuntimeDisabled
	case MCPRuntimeModeReadOnly:
		if action {
			return errMCPRuntimeReadOnly
		}
	}
	return nil
}

func (s *server) recordTool(ctx context.Context, toolName string, started time.Time, err error, action, replayed bool, resourceID uuid.UUID) {
	if s.db == nil {
		return
	}

	status := "success"
	errorCode := ""
	if err != nil {
		status = "error"
		errorCode = mcpErrorCode(err)
		if errors.Is(err, errMCPRuntimeDisabled) || errors.Is(err, errMCPRuntimeReadOnly) {
			status = "rejected"
		}
	}

	userID := s.identity.UserID.String()
	event := &models.MCPInteraction{
		ID:         uuid.New(),
		UserID:     &userID,
		Transport:  transportFromContext(ctx),
		ToolName:   toolName,
		Status:     status,
		DurationMs: int(time.Since(started).Milliseconds()),
		Action:     action,
		Replayed:   replayed,
		ErrorCode:  errorCode,
		CreatedAt:  time.Now().UTC(),
	}
	if resourceID != uuid.Nil {
		event.ResourceID = &resourceID
	}

	go func() {
		if _, insertErr := s.db.NewInsert().Model(event).Exec(context.Background()); insertErr != nil {
			log.Debugf("mcp analytics: failed to record interaction: %v", insertErr)
		}
	}()
}

// RecordHTTPRejection records an authentication or runtime rejection that
// happens before the SDK invokes a tool handler.
func RecordHTTPRejection(db *bun.DB, started time.Time, toolName, errorCode string) {
	if db == nil {
		return
	}
	event := &models.MCPInteraction{
		ID:         uuid.New(),
		Transport:  TransportHTTP,
		ToolName:   toolName,
		Status:     "rejected",
		DurationMs: int(time.Since(started).Milliseconds()),
		ErrorCode:  errorCode,
		CreatedAt:  time.Now().UTC(),
	}
	go func() {
		if _, err := db.NewInsert().Model(event).Exec(context.Background()); err != nil {
			log.Debugf("mcp analytics: failed to record HTTP rejection: %v", err)
		}
	}()
}

func mcpErrorCode(err error) string {
	switch {
	case errors.Is(err, errMCPRuntimeDisabled):
		return "runtime_disabled"
	case errors.Is(err, errMCPRuntimeReadOnly):
		return "actions_disabled"
	default:
		return "tool_error"
	}
}
