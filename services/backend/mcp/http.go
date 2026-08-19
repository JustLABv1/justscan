package mcpserver

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"justscan-backend/config"
	"justscan-backend/middlewares"

	"github.com/gin-gonic/gin"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/uptrace/bun"
)

// NewHTTPHandler exposes a stateless Streamable HTTP MCP endpoint. The
// existing JustScan personal/user bearer token is validated before the SDK
// handler is created, so session state can never outlive the authenticated
// request that created it.
//
// This endpoint intentionally uses JustScan bearer tokens rather than claiming
// to be a complete OAuth authorization server. OAuth discovery and delegated
// identity can be added once JustScan has a resource-token issuer and audience
// validation path separate from its browser-login OIDC flow.
func NewHTTPHandler(db *bun.DB, cfg config.MCPConf) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		started := time.Now()
		identity, err := authenticateHTTPRequest(request, db)
		if err != nil {
			RecordHTTPRejection(db, started, "authentication", "authentication_failed")
			writeUnauthorized(writer)
			return
		}
		if LoadRuntimeMode(request.Context(), db) == MCPRuntimeModeDisabled {
			RecordHTTPRejection(db, started, "runtime", "runtime_disabled")
			writeRuntimeDisabled(writer)
			return
		}
		serveAuthenticatedHTTP(writer, request, db, cfg, identity)
	})
}

// NewGinHandler is the router-facing adapter. It mirrors the normal Gin auth
// context for request logging while keeping the MCP protocol handler in the
// net/http layer.
func NewGinHandler(db *bun.DB, cfg config.MCPConf) gin.HandlerFunc {
	return func(context *gin.Context) {
		started := time.Now()
		identity, err := authenticateHTTPRequest(context.Request, db)
		if err != nil {
			RecordHTTPRejection(db, started, "authentication", "authentication_failed")
			writeUnauthorized(context.Writer)
			context.Abort()
			return
		}
		if LoadRuntimeMode(context.Request.Context(), db) == MCPRuntimeModeDisabled {
			RecordHTTPRejection(db, started, "runtime", "runtime_disabled")
			writeRuntimeDisabled(context.Writer)
			context.Abort()
			return
		}
		context.Set(middlewares.AuthContextUserIDKey, identity.UserID)
		context.Set(middlewares.AuthContextIsAdminKey, identity.IsAdmin)
		serveAuthenticatedHTTP(context.Writer, context.Request, db, cfg, identity)
	}
}

func authenticateHTTPRequest(request *http.Request, db *bun.DB) (Identity, error) {
	return AuthenticatePersonalToken(request.Context(), db, bearerToken(request.Header.Get("Authorization")))
}

func serveAuthenticatedHTTP(writer http.ResponseWriter, request *http.Request, db *bun.DB, cfg config.MCPConf, identity Identity) {
	request = request.WithContext(WithTransport(request.Context(), TransportHTTP))
	server := NewServer(db, identity, cfg.MaxPageSize)
	handler := sdk.NewStreamableHTTPHandler(func(*http.Request) *sdk.Server {
		return server
	}, &sdk.StreamableHTTPOptions{
		Stateless:                    true,
		JSONResponse:                 true,
		MaxRequestBodyBytes:          cfg.MaxRequestBodyBytes,
		PropagateRequestCancellation: true,
	})
	handler.ServeHTTP(writer, request)
}

func writeUnauthorized(writer http.ResponseWriter) {
	writer.Header().Set("WWW-Authenticate", `Bearer realm="JustScan MCP"`)
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(writer).Encode(map[string]string{
		"error": "a valid JustScan personal bearer token is required",
	})
}

func writeRuntimeDisabled(writer http.ResponseWriter) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(http.StatusServiceUnavailable)
	_ = json.NewEncoder(writer).Encode(map[string]string{
		"error": "MCP is temporarily disabled by an administrator",
	})
}

func bearerToken(header string) string {
	value := strings.TrimSpace(header)
	if len(value) < len("Bearer ") || !strings.EqualFold(value[:len("Bearer ")], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(value[len("Bearer "):])
}
