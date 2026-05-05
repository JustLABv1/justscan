package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"justscan-backend/config"
	aifuncs "justscan-backend/functions/ai"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type createConversationRequest struct {
	Title     string `json:"title"`
	ScopeType string `json:"scopeType"`
	ScopeRef  string `json:"scopeRef"`
}

type sendConversationMessageRequest struct {
	ProviderKey string                   `json:"providerKey"`
	Message     string                   `json:"message"`
	Context     string                   `json:"context"`
	Sources     []models.AIMessageSource `json:"sources"`
}

func ListConversations(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !requireAIEnabled(c) {
			return
		}

		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		conversations := make([]models.AIConversation, 0)
		query := db.NewSelect().Model(&conversations).Where("user_id = ?", userID).Order("updated_at DESC")
		if scopeType := strings.TrimSpace(c.Query("scopeType")); scopeType != "" {
			query = query.Where("scope_type = ?", scopeType)
		}
		if scopeRef := strings.TrimSpace(c.Query("scopeRef")); scopeRef != "" {
			query = query.Where("scope_ref = ?", scopeRef)
		}

		if err := query.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list AI conversations"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"conversations": conversations})
	}
}

func CreateConversation(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !requireAIEnabled(c) {
			return
		}

		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		var req createConversationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		now := time.Now().UTC()
		conversation := models.AIConversation{
			UserID:      &userID,
			OwnerUserID: &userID,
			Title:       conversationTitle(req.Title, req.ScopeType, req.ScopeRef),
			ScopeType:   normalizeScopeType(req.ScopeType),
			ScopeRef:    strings.TrimSpace(req.ScopeRef),
			CreatedAt:   now,
			UpdatedAt:   now,
		}

		if _, err := db.NewInsert().Model(&conversation).Returning("*").Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create AI conversation"})
			return
		}

		c.JSON(http.StatusCreated, conversation)
	}
}

func GetConversation(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !requireAIEnabled(c) {
			return
		}

		conversation, ok := loadOwnedConversation(c, db)
		if !ok {
			return
		}

		messages := make([]models.AIMessage, 0)
		if err := db.NewSelect().Model(&messages).Where("conversation_id = ?", conversation.ID).Order("created_at ASC").Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI messages"})
			return
		}
		conversation.Messages = messages

		c.JSON(http.StatusOK, conversation)
	}
}

func DeleteConversation(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !requireAIEnabled(c) {
			return
		}

		conversation, ok := loadOwnedConversation(c, db)
		if !ok {
			return
		}

		if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.NewDelete().Model((*models.AIMessage)(nil)).Where("conversation_id = ?", conversation.ID).Exec(ctx); err != nil {
				return err
			}
			_, err := tx.NewDelete().Model((*models.AIConversation)(nil)).Where("id = ?", conversation.ID).Exec(ctx)
			return err
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete AI conversation"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}

func SendMessage(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !requireAIEnabled(c) {
			return
		}

		conversation, ok := loadOwnedConversation(c, db)
		if !ok {
			return
		}

		var req sendConversationMessageRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		messageText := strings.TrimSpace(req.Message)
		if messageText == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "message is required"})
			return
		}

		runtime, err := aifuncs.ResolveProvider(c.Request.Context(), db, req.ProviderKey)
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, aifuncs.ErrProviderNotConfigured) {
				status = http.StatusConflict
			}
			c.JSON(status, gin.H{"error": err.Error()})
			return
		}

		history := make([]models.AIMessage, 0)
		if err := db.NewSelect().Model(&history).Where("conversation_id = ?", conversation.ID).Order("created_at ASC").Limit(24).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI history"})
			return
		}

		provider := aifuncs.NewChatProvider(runtime)
		promptMessages := buildPromptMessages(conversation, history, messageText, req.Context, runtime.MaxContextTokens)
		response, err := provider.Chat(c.Request.Context(), aifuncs.ChatRequest{
			Messages:        promptMessages,
			MaxOutputTokens: runtime.MaxOutputTokens,
			Temperature:     runtime.Temperature,
		})
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}

		assistantContent, toolCalls := extractAssistantToolCalls(strings.TrimSpace(response.Content))
		now := time.Now().UTC()
		userMessage := models.AIMessage{
			ConversationID: conversation.ID,
			Role:           "user",
			Content:        messageText,
			Sources:        []models.AIMessageSource{},
			CreatedAt:      now,
		}
		assistantMessage := models.AIMessage{
			ConversationID: conversation.ID,
			Role:           "assistant",
			Content:        assistantContent,
			ProviderKey:    runtime.Key,
			ProviderType:   runtime.Type,
			Model:          response.Model,
			PromptTokens:   response.Usage.PromptTokens,
			ResponseTokens: response.Usage.ResponseTokens,
			Sources:        []models.AIMessageSource{},
			ToolCalls:      toolCalls,
			CreatedAt:      now,
		}
		conversation.UpdatedAt = now

		if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.NewInsert().Model(&userMessage).Returning("*").Exec(ctx); err != nil {
				return err
			}
			if _, err := tx.NewInsert().Model(&assistantMessage).Returning("*").Exec(ctx); err != nil {
				return err
			}
			_, err := tx.NewUpdate().Model((*models.AIConversation)(nil)).Set("updated_at = ?", now).Where("id = ?", conversation.ID).Exec(ctx)
			return err
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save AI messages"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"conversation": conversation,
			"message":      assistantMessage,
		})
	}
}

func requireAIEnabled(c *gin.Context) bool {
	settings := aifuncs.EffectiveSettings(config.GetConfigInstance())
	if !settings.Enabled {
		c.JSON(http.StatusForbidden, gin.H{"error": "AI is disabled"})
		return false
	}
	return true
}

func loadOwnedConversation(c *gin.Context, db *bun.DB) (models.AIConversation, bool) {
	userID, _, ok := authz.RequireRequestUser(c, db)
	if !ok {
		return models.AIConversation{}, false
	}

	conversationID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid conversation ID"})
		return models.AIConversation{}, false
	}

	var conversation models.AIConversation
	if err := db.NewSelect().Model(&conversation).Where("id = ? AND user_id = ?", conversationID, userID).Scan(c.Request.Context()); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
			return models.AIConversation{}, false
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load conversation"})
		return models.AIConversation{}, false
	}

	return conversation, true
}

func buildPromptMessages(conversation models.AIConversation, history []models.AIMessage, question string, contextText string, maxContextTokens int) []aifuncs.ChatMessage {
	contextLimit := maxContextTokens * 4
	if contextLimit <= 0 {
		contextLimit = 24000
	}

	systemPrompt := strings.TrimSpace(`You are the JustScan assistant. Help users understand scans, vulnerabilities, suppressions, watchlists, registries, organizations, and admin settings.
Use the provided context first. If the context is incomplete, say exactly what is missing instead of inventing details.
When users ask how to navigate, mention concrete in-app routes like /dashboard, /scans, /watchlist, /vulnkb, /suppressions, /registries, /tags, /orgs, /settings, and /admin for admins.
If a user asks you to perform an action you cannot directly execute, explain the nearest JustScan UI action or route.
When suggesting a follow-up action that the UI can perform, append one compact action line per action at the end of your answer using EXACTLY this format with no markdown fence:
<<action:{"name":"open_route","arguments":{"route":"/registries"}}>>
Supported action names are open_route, start_scan, and rescan_scope.
For open_route, provide an arguments.route string.
For start_scan, provide arguments.images as an array of full image references like ["nginx:latest"].
For rescan_scope, do not provide arguments unless the current scope is a scan.
Never emit action lines unless the action is a concrete next step the user is likely to want.`)

	if scopeType := strings.TrimSpace(conversation.ScopeType); scopeType != "" {
		systemPrompt += fmt.Sprintf("\n\nCurrent scope: %s", scopeType)
		if scopeRef := strings.TrimSpace(conversation.ScopeRef); scopeRef != "" {
			systemPrompt += fmt.Sprintf(" (%s)", scopeRef)
		}
	}

	trimmedContext := trimRunes(strings.TrimSpace(contextText), contextLimit)
	if trimmedContext != "" {
		systemPrompt += "\n\nJustScan context:\n" + trimmedContext
	}

	messages := []aifuncs.ChatMessage{{Role: "system", Content: systemPrompt}}
	for _, message := range lastMessages(history, 12) {
		if message.Role != "user" && message.Role != "assistant" {
			continue
		}
		content := strings.TrimSpace(message.Content)
		if content == "" {
			continue
		}
		messages = append(messages, aifuncs.ChatMessage{Role: message.Role, Content: content})
	}
	messages = append(messages, aifuncs.ChatMessage{Role: "user", Content: question})
	return messages
}

func lastMessages(messages []models.AIMessage, limit int) []models.AIMessage {
	if limit <= 0 || len(messages) <= limit {
		return messages
	}
	return messages[len(messages)-limit:]
}

func conversationTitle(value string, scopeType string, scopeRef string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		if strings.TrimSpace(scopeType) != "" && strings.TrimSpace(scopeRef) != "" {
			trimmed = fmt.Sprintf("%s chat", strings.TrimSpace(scopeType))
		} else {
			trimmed = "New chat"
		}
	}
	runes := []rune(trimmed)
	if len(runes) > 80 {
		return strings.TrimSpace(string(runes[:80])) + "..."
	}
	return trimmed
}

func normalizeScopeType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "scan", "vulnerability", "watchlist", "registry", "admin", "global":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "global"
	}
}

func trimRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return strings.TrimSpace(string(runes[:limit])) + "..."
}

var assistantActionPattern = regexp.MustCompile(`(?m)^<<action:(\{.*\})>>\s*$`)

func extractAssistantToolCalls(content string) (string, []models.AIToolCall) {
	toolCalls := make([]models.AIToolCall, 0)
	matches := assistantActionPattern.FindAllStringSubmatch(content, -1)
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}

		var raw struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		if err := json.Unmarshal([]byte(match[1]), &raw); err != nil {
			continue
		}

		name := strings.TrimSpace(raw.Name)
		if !isSupportedAssistantTool(name, raw.Arguments) {
			continue
		}

		toolCalls = append(toolCalls, models.AIToolCall{
			Name:                 name,
			Status:               "pending",
			Arguments:            raw.Arguments,
			ConfirmationRequired: true,
		})
	}

	cleanContent := strings.TrimSpace(assistantActionPattern.ReplaceAllString(content, ""))
	if cleanContent == "" && len(toolCalls) > 0 {
		cleanContent = "I suggested an action below."
	}
	return cleanContent, toolCalls
}

func isSupportedAssistantTool(name string, arguments map[string]any) bool {
	switch name {
	case "open_route":
		route, _ := arguments["route"].(string)
		return strings.HasPrefix(strings.TrimSpace(route), "/")
	case "start_scan":
		rawImages, ok := arguments["images"].([]any)
		if !ok || len(rawImages) == 0 {
			return false
		}
		for _, value := range rawImages {
			image, ok := value.(string)
			if !ok || strings.TrimSpace(image) == "" {
				return false
			}
		}
		return true
	case "rescan_scope":
		return true
	default:
		return false
	}
}
