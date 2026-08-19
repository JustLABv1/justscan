package admins

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"justscan-backend/config"
	"justscan-backend/functions/audit"
	mcpserver "justscan-backend/mcp"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type MCPSettingsResponse struct {
	Mode           string `json:"mode"`
	ActionsEnabled bool   `json:"actions_enabled"`
	ConfigEnabled  bool   `json:"config_enabled"`
	HTTPEnabled    bool   `json:"http_enabled"`
	Endpoint       string `json:"endpoint"`
}

type MCPMetricsResponse struct {
	TotalCalls      int64   `json:"total_calls"`
	SuccessfulCalls int64   `json:"successful_calls"`
	FailedCalls     int64   `json:"failed_calls"`
	RejectedCalls   int64   `json:"rejected_calls"`
	ErrorRate       float64 `json:"error_rate"`
	AvgDurationMs   float64 `json:"avg_duration_ms"`
	P95DurationMs   float64 `json:"p95_duration_ms"`
	ActiveUsers     int64   `json:"active_users"`
	ActionCalls     int64   `json:"action_calls"`
	ReplayedActions int64   `json:"replayed_actions"`
}

type MCPToolMetric struct {
	ToolName        string  `json:"tool_name" bun:"tool_name"`
	Calls           int64   `json:"calls" bun:"calls"`
	Errors          int64   `json:"errors" bun:"errors"`
	Actions         int64   `json:"actions" bun:"actions"`
	ReplayedActions int64   `json:"replayed_actions" bun:"replayed_actions"`
	AvgDurationMs   float64 `json:"avg_duration_ms" bun:"avg_duration_ms"`
}

type MCPTransportMetric struct {
	Transport string `json:"transport" bun:"transport"`
	Calls     int64  `json:"calls" bun:"calls"`
	Errors    int64  `json:"errors" bun:"errors"`
	Actions   int64  `json:"actions" bun:"actions"`
}

type MCPInteractionAdmin struct {
	ID         uuid.UUID  `json:"id" bun:"id"`
	UserID     *string    `json:"user_id,omitempty" bun:"user_id"`
	Username   string     `json:"username,omitempty" bun:"username"`
	Email      string     `json:"email,omitempty" bun:"email"`
	Transport  string     `json:"transport" bun:"transport"`
	ToolName   string     `json:"tool_name" bun:"tool_name"`
	Status     string     `json:"status" bun:"status"`
	DurationMs int        `json:"duration_ms" bun:"duration_ms"`
	Action     bool       `json:"action" bun:"action"`
	Replayed   bool       `json:"replayed" bun:"replayed"`
	ResourceID *uuid.UUID `json:"resource_id,omitempty" bun:"resource_id"`
	ErrorCode  string     `json:"error_code,omitempty" bun:"error_code"`
	CreatedAt  time.Time  `json:"created_at" bun:"created_at"`
}

type MCPOverviewResponse struct {
	Window         string                `json:"window"`
	From           time.Time             `json:"from"`
	To             time.Time             `json:"to"`
	Settings       MCPSettingsResponse   `json:"settings"`
	Metrics        MCPMetricsResponse    `json:"metrics"`
	ByTool         []MCPToolMetric       `json:"by_tool"`
	ByTransport    []MCPTransportMetric  `json:"by_transport"`
	RecentActivity []MCPInteractionAdmin `json:"recent_activity"`
}

func GetMCPOverview(c *gin.Context, db *bun.DB) {
	from, to, window := mcpRange(c)
	ctx := c.Request.Context()
	applyRange := func(q *bun.SelectQuery, alias string) *bun.SelectQuery {
		return q.Where(alias+".created_at >= ?", from).Where(alias+".created_at < ?", to)
	}

	var summary struct {
		Total    int64   `bun:"total"`
		Success  int64   `bun:"success"`
		Errors   int64   `bun:"errors"`
		Rejected int64   `bun:"rejected"`
		Avg      float64 `bun:"avg_ms"`
		P95      float64 `bun:"p95_ms"`
		Users    int64   `bun:"users"`
		Actions  int64   `bun:"actions"`
		Replayed int64   `bun:"replayed"`
	}
	if err := applyRange(db.NewSelect().TableExpr("mcp_interactions AS i").
		ColumnExpr("COUNT(*) AS total").
		ColumnExpr("COUNT(*) FILTER (WHERE i.status = 'success') AS success").
		ColumnExpr("COUNT(*) FILTER (WHERE i.status = 'error') AS errors").
		ColumnExpr("COUNT(*) FILTER (WHERE i.status = 'rejected') AS rejected").
		ColumnExpr("COALESCE(AVG(i.duration_ms), 0) AS avg_ms").
		ColumnExpr("COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY i.duration_ms), 0) AS p95_ms").
		ColumnExpr("COUNT(DISTINCT i.user_id) FILTER (WHERE i.user_id IS NOT NULL) AS users").
		ColumnExpr("COUNT(*) FILTER (WHERE i.action = TRUE) AS actions").
		ColumnExpr("COUNT(*) FILTER (WHERE i.replayed = TRUE) AS replayed"), "i").Scan(ctx, &summary); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to compute MCP usage stats"})
		return
	}

	metrics := MCPMetricsResponse{
		TotalCalls:      summary.Total,
		SuccessfulCalls: summary.Success,
		FailedCalls:     summary.Errors,
		RejectedCalls:   summary.Rejected,
		AvgDurationMs:   summary.Avg,
		P95DurationMs:   summary.P95,
		ActiveUsers:     summary.Users,
		ActionCalls:     summary.Actions,
		ReplayedActions: summary.Replayed,
	}
	if summary.Total > 0 {
		metrics.ErrorRate = float64(summary.Errors+summary.Rejected) / float64(summary.Total)
	}

	var byTool []MCPToolMetric
	if err := applyRange(db.NewSelect().TableExpr("mcp_interactions AS i").
		ColumnExpr("i.tool_name").
		ColumnExpr("COUNT(*) AS calls").
		ColumnExpr("COUNT(*) FILTER (WHERE i.status <> 'success') AS errors").
		ColumnExpr("COUNT(*) FILTER (WHERE i.action = TRUE) AS actions").
		ColumnExpr("COUNT(*) FILTER (WHERE i.replayed = TRUE) AS replayed_actions").
		ColumnExpr("COALESCE(AVG(i.duration_ms), 0) AS avg_duration_ms").
		GroupExpr("i.tool_name").OrderExpr("calls DESC").Limit(20), "i").Scan(ctx, &byTool); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to compute MCP tool stats"})
		return
	}
	if byTool == nil {
		byTool = []MCPToolMetric{}
	}

	var byTransport []MCPTransportMetric
	if err := applyRange(db.NewSelect().TableExpr("mcp_interactions AS i").
		ColumnExpr("i.transport").
		ColumnExpr("COUNT(*) AS calls").
		ColumnExpr("COUNT(*) FILTER (WHERE i.status <> 'success') AS errors").
		ColumnExpr("COUNT(*) FILTER (WHERE i.action = TRUE) AS actions").
		GroupExpr("i.transport").OrderExpr("calls DESC"), "i").Scan(ctx, &byTransport); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to compute MCP transport stats"})
		return
	}
	if byTransport == nil {
		byTransport = []MCPTransportMetric{}
	}

	recent, err := queryMCPInteractions(ctx, db, from, to, 12, 0)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load recent MCP activity"})
		return
	}
	if recent == nil {
		recent = []MCPInteractionAdmin{}
	}

	c.JSON(http.StatusOK, MCPOverviewResponse{
		Window:         window,
		From:           from,
		To:             to,
		Settings:       currentMCPSettings(db, ctx),
		Metrics:        metrics,
		ByTool:         byTool,
		ByTransport:    byTransport,
		RecentActivity: recent,
	})
}

func GetMCPActivity(c *gin.Context, db *bun.DB) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 50
	}

	from, to, _ := mcpRange(c)
	q := db.NewSelect().TableExpr("mcp_interactions AS i")
	q = mcpInteractionColumns(q).Where("i.created_at >= ?", from).Where("i.created_at < ?", to)
	if tool := strings.TrimSpace(c.Query("tool")); tool != "" {
		q = q.Where("i.tool_name = ?", tool)
	}
	if transport := strings.TrimSpace(c.Query("transport")); transport != "" {
		q = q.Where("i.transport = ?", transport)
	}
	if status := strings.TrimSpace(c.Query("status")); status != "" {
		q = q.Where("i.status = ?", status)
	}
	if user := strings.TrimSpace(c.Query("user")); user != "" {
		pattern := "%" + user + "%"
		q = q.WhereGroup(" AND ", func(sq *bun.SelectQuery) *bun.SelectQuery {
			return sq.Where("u.username ILIKE ?", pattern).
				WhereOr("u.email ILIKE ?", pattern).
				WhereOr("i.user_id ILIKE ?", pattern)
		})
	}

	var entries []MCPInteractionAdmin
	total, err := q.OrderExpr("i.created_at DESC").Limit(limit).Offset((page-1)*limit).ScanAndCount(c.Request.Context(), &entries)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load MCP activity"})
		return
	}
	if entries == nil {
		entries = []MCPInteractionAdmin{}
	}
	c.JSON(http.StatusOK, gin.H{"data": entries, "total": total})
}

func GetMCPSettings(c *gin.Context, db *bun.DB) {
	c.JSON(http.StatusOK, currentMCPSettings(db, c.Request.Context()))
}

func UpdateMCPSettings(c *gin.Context, db *bun.DB) {
	var request struct {
		Mode string `json:"mode"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	mode := strings.ToLower(strings.TrimSpace(request.Mode))
	if mode != mcpserver.MCPRuntimeModeEnabled && mode != mcpserver.MCPRuntimeModeReadOnly && mode != mcpserver.MCPRuntimeModeDisabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "mode must be enabled, read_only, or disabled"})
		return
	}
	if err := upsertSystemSetting(c, db, mcpserver.MCPRuntimeModeKey, mode); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update MCP runtime mode"})
		return
	}
	if userID, err := getAIAuditUserID(c); err == nil {
		go audit.Write(c.Request.Context(), db, userID.String(), "settings.mcp.update", "set MCP runtime mode to "+mode)
	}
	c.JSON(http.StatusOK, currentMCPSettings(db, c.Request.Context()))
}

func currentMCPSettings(db *bun.DB, ctx context.Context) MCPSettingsResponse {
	mode := mcpserver.LoadRuntimeMode(ctx, db)
	response := MCPSettingsResponse{
		Mode:           mode,
		ActionsEnabled: mode == mcpserver.MCPRuntimeModeEnabled,
	}
	if config.Config != nil {
		response.ConfigEnabled = config.Config.MCP.Enabled
		response.HTTPEnabled = config.Config.MCP.HTTPEnabled
		response.Endpoint = config.Config.MCP.Endpoint
	}
	return response
}

func mcpInteractionColumns(q *bun.SelectQuery) *bun.SelectQuery {
	return q.ColumnExpr("i.*, COALESCE(u.username, '') AS username, COALESCE(u.email, '') AS email").
		Join("LEFT JOIN users u ON u.id::text = i.user_id")
}

func queryMCPInteractions(ctx context.Context, db *bun.DB, from, to time.Time, limit, offset int) ([]MCPInteractionAdmin, error) {
	var entries []MCPInteractionAdmin
	q := mcpInteractionColumns(db.NewSelect().TableExpr("mcp_interactions AS i")).
		Where("i.created_at >= ?", from).
		Where("i.created_at < ?", to).
		OrderExpr("i.created_at DESC").Limit(limit).Offset(offset)
	if err := q.Scan(ctx, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

func mcpRange(c *gin.Context) (time.Time, time.Time, string) {
	to := time.Now().UTC()
	window := c.DefaultQuery("window", "24h")
	duration := 24 * time.Hour
	switch window {
	case "7d":
		duration = 7 * 24 * time.Hour
	case "30d":
		duration = 30 * 24 * time.Hour
	default:
		window = "24h"
	}
	from := to.Add(-duration)
	if raw := c.Query("from"); raw != "" {
		if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
			from = parsed.UTC()
		}
	}
	if raw := c.Query("to"); raw != "" {
		if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
			to = parsed.UTC()
		}
	}
	if !from.Before(to) {
		from = to.Add(-duration)
	}
	return from, to, window
}
